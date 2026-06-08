/* ============================================================================
   tg-daily-task-scan — Sprint 2 of TG Task Bot (05.06.2026)
   ============================================================================
   Cron 16:00 UTC (18:00 CET). Іде по всіх whitelisted чатах з proactive=true.
   Для кожного:
     1. Витягає unprocessed повідомлення за останні 24 год з tg_chat_buffer
     2. Якщо < 3 → skip
     3. Передає батч у Claude Haiku з prompt "знайди задачі"
     4. Парсить JSON → filter confidence >= 0.6
     5. INSERT кожну у tg_proposed_tasks (source='digest')
     6. Mark buffer entries processed_at
     7. Якщо знайдено > 0 → post у чат digest message з cnt
============================================================================ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TG_BOT_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

interface BufferMsg {
  message_id: number;
  user_tg_id: number;
  user_name: string | null;
  text: string;
  reply_to: number | null;
  ts: string;
}

interface ExtractedTask {
  title: string;
  description: string | null;
  assignee_hint: string | null;
  due_date: string | null;
  priority: "p1" | "p2" | "p3" | null;
  confidence: number;
  source_user: string | null; // хто з юзерів казав
  source_message_id: number | null; // якщо можна привʼязати
}

interface UserRow {
  id: string;
  name: string | null;
  tg_username: string | null;
  tg_chat_id: string | null;
  role: string;
  is_active: boolean;
}

// ---------------------------------------------------------------------
// Claude batch prompt
// ---------------------------------------------------------------------
function buildSystemPrompt(today: string, teamMembers: UserRow[]): string {
  const memberList = teamMembers
    .map((u) => `- ${u.name || "?"}${u.tg_username ? " (@" + u.tg_username + ")" : ""}`)
    .join("\n");

  return `Ти асистент DreamCar. Тобі дають лог Telegram-чату за день. Знайди ВСІ потенційні задачі що згадувались але можуть бути не оформлені.

ЩО Є ЗАДАЧЕЮ:
- Конкретна дія яку потрібно зробити людині ("зроби X", "треба підготувати Y", "запусти Z")
- З явним або підрозумілим виконавцем
- З результатом що очікується

ЩО НЕ Є ЗАДАЧЕЮ:
- Питання про статус ("як справи з лендингом?")
- Обговорення без action item
- Згадка вже зробленої роботи
- Привітання, smalltalk, жарти
- Задачі що вже були поставлені раніше у цьому ж логу (не дублюй)

Сьогодні: ${today} (YYYY-MM-DD)

Команда DreamCar:
${memberList}

ПРАВИЛА:
- title: 60 символів макс, наказова форма
- description: 250 символів макс, додатковий контекст або null
- assignee_hint: ім'я зі списку команди (наприклад "Саша", "Артем") або @username; null якщо не вказано
- due_date: YYYY-MM-DD або null. "сьогодні"→${today}, "завтра"→+1, "до пʼятниці"→найближча пʼятниця, "до 10.06"→дата
- priority: p1 (терміново), p2 (важливо), p3 (звичайний). Default p3
- confidence: 0.0-1.0. Тільки задачі з confidence >= 0.6
- source_user: хто з юзерів казав цю задачу (з лог)
- source_message_id: message_id з лог якщо можна звʼязати

Відповідай ЛИШЕ JSON у форматі:
{ "tasks": [ {...}, {...} ] }

Якщо нічого — { "tasks": [] }.`;
}

async function extractTasksWithClaude(
  conversation: string,
  teamMembers: UserRow[],
): Promise<ExtractedTask[]> {
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = buildSystemPrompt(today, teamMembers);
  const userText = `Лог чату за день:\n\n${conversation}\n\nПоверни JSON з усіма знайденими задачами.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`Claude API ${r.status}: ${errBody.slice(0, 200)}`);
  }

  const json = await r.json();
  const content = json.content?.[0]?.text || "{}";
  try {
    const m = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : content);
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch (_e) {
    console.error("[daily-scan] parse fail:", content.slice(0, 300));
    return [];
  }
}

// ---------------------------------------------------------------------
// Resolve assignee — reuse тих самих patterns як у tg-task-extract
// ---------------------------------------------------------------------
function resolveAssignee(hint: string | null, members: UserRow[]): string | null {
  if (!hint) return null;
  const raw = hint.trim();
  const candidates: string[] = [];
  const atMatches = raw.match(/@([a-zA-Z0-9_]+)/g);
  if (atMatches) for (const m of atMatches) candidates.push(m);
  const firstWord = raw.split(/[\s,()\[\]]+/).filter(Boolean)[0];
  if (firstWord && !candidates.includes(firstWord)) candidates.push(firstWord);
  if (!candidates.includes(raw)) candidates.push(raw);
  for (const cand of candidates) {
    const norm = cand.toLowerCase().replace(/^@/, "").trim();
    if (!norm) continue;
    for (const u of members) {
      if (u.tg_username && u.tg_username.toLowerCase() === norm) return u.id;
      if (u.name && u.name.toLowerCase() === norm) return u.id;
      if (u.name && u.name.toLowerCase().split(/\s+/).some((p) => p === norm)) return u.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// TG helpers
// ---------------------------------------------------------------------
async function tgSendMessage(
  chatId: number,
  text: string,
  inlineKeyboard?: Array<Array<Record<string, string>>>,
): Promise<{ ok: boolean; err?: string; message_id?: number }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) return { ok: false, err: j.description };
  return { ok: true, message_id: j.result.message_id };
}

function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as Record<string, string>)[c]);
}

// ---------------------------------------------------------------------
// Per-chat scan
// ---------------------------------------------------------------------
async function scanChat(
  supabase: ReturnType<typeof createClient>,
  chat: { chat_id: number; chat_title: string | null; default_assignee_id: string | null },
  teamMembers: UserRow[],
): Promise<{ chat_id: number; proposed_count: number; skipped?: string }> {
  // 1. Витягти unprocessed messages за останні 24 год
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: msgs } = await supabase
    .from("tg_chat_buffer")
    // 08.06.2026: підтягуємо attachments + caption (для прикріплення фото/файлів до proposal)
    .select("message_id, user_tg_id, user_name, text, reply_to, ts, attachments, caption")
    .eq("chat_id", chat.chat_id)
    .is("processed_at", null)
    .gte("ts", cutoff)
    .order("ts", { ascending: true })
    .limit(500);

  if (!msgs || msgs.length < 3) {
    return { chat_id: chat.chat_id, proposed_count: 0, skipped: "too_few_msgs" };
  }

  // 2. Conversation format
  const conversation = (msgs as BufferMsg[])
    .map((m) => {
      const time = m.ts.substring(11, 16);
      return `[${time}] [msg ${m.message_id}] ${m.user_name || "?"}: ${m.text}`;
    })
    .join("\n");

  // 3. LLM extract
  const extracted = await extractTasksWithClaude(conversation, teamMembers);
  const filtered = extracted.filter((t) => t.confidence >= 0.6);

  // 4. Resolve assignees + INSERT
  let inserted = 0;
  const summary: { title: string; assignee_name: string | null; proposed_id: string; attachments_count?: number }[] = [];
  for (const t of filtered) {
    const assigneeId = resolveAssignee(t.assignee_hint, teamMembers) || chat.default_assignee_id || null;
    const assigneeName = assigneeId ? teamMembers.find((u) => u.id === assigneeId)?.name || null : null;

    // Знайти proposer = author message_id або перший CEO/COO у members
    let proposerId: string | null = null;
    if (t.source_user) {
      const m = (msgs as BufferMsg[]).find(
        (msg) => (msg.user_name || "").toLowerCase().includes(t.source_user!.toLowerCase()),
      );
      if (m) {
        const found = teamMembers.find((u) => u.tg_chat_id === String(m.user_tg_id));
        if (found) proposerId = found.id;
      }
    }
    if (!proposerId) {
      proposerId = teamMembers.find((u) => u.role === "ceo")?.id ||
        teamMembers.find((u) => u.role === "coo")?.id || null;
    }
    if (!proposerId) continue;

    const sourceMsg = t.source_message_id
      ? (msgs as any[]).find((m) => m.message_id === t.source_message_id)
      : null;
    const sourceText = sourceMsg?.text || t.title;

    // 08.06.2026 NEW (Давид): підтягуємо attachments з source message + media-group neighbours
    // якщо source message це reply на photo/document, або має caption
    let attachments: any[] = [];
    if (sourceMsg?.attachments && Array.isArray(sourceMsg.attachments) && sourceMsg.attachments.length) {
      attachments = sourceMsg.attachments;
    }
    // Також перевіряємо сусідні msgs ±2 (TG групує media як окремі повідомлення підряд)
    if (sourceMsg) {
      const idx = (msgs as any[]).findIndex((m) => m.message_id === sourceMsg.message_id);
      if (idx >= 0) {
        for (let delta = -2; delta <= 2; delta++) {
          if (delta === 0) continue;
          const neighbor = (msgs as any[])[idx + delta];
          if (!neighbor) continue;
          if (Math.abs(new Date(neighbor.ts).getTime() - new Date(sourceMsg.ts).getTime()) > 30_000) continue;
          if (neighbor.user_tg_id !== sourceMsg.user_tg_id) continue;
          if (Array.isArray(neighbor.attachments) && neighbor.attachments.length) {
            // Уникаємо duplicates за storage_path або url
            for (const a of neighbor.attachments) {
              if (!attachments.some((x) => (x.url || x.storage_path) === (a.url || a.storage_path))) {
                attachments.push(a);
              }
            }
          }
        }
      }
    }

    const { data: prop, error: insErr } = await supabase
      .from("tg_proposed_tasks")
      .insert({
        state: "proposed",
        source: "digest",
        chat_id: chat.chat_id,
        message_id: t.source_message_id,
        proposer_id: proposerId,
        source_text: sourceText,
        title: t.title,
        description: t.description,
        assignee_hint: t.assignee_hint,
        assignee_id: assigneeId,
        due_date: t.due_date,
        priority: t.priority,
        confidence: t.confidence,
        attachments: attachments,
      })
      .select("id")
      .single();

    if (!insErr && prop) {
      inserted++;
      summary.push({
        title: t.title,
        assignee_name: assigneeName,
        proposed_id: prop.id,
        attachments_count: attachments.length,
      });
    }
  }

  // 5. Mark buffer processed
  await supabase
    .from("tg_chat_buffer")
    .update({ processed_at: new Date().toISOString() })
    .eq("chat_id", chat.chat_id)
    .is("processed_at", null)
    .gte("ts", cutoff);

  // 6. Post у чат — батчимо по 5 задач на повідомлення (TG лімітує inline buttons,
  // плюс UX краще коли пачка ≤5)
  if (inserted > 0) {
    const BATCH_SIZE = 5;
    const totalBatches = Math.ceil(summary.length / BATCH_SIZE);
    // Перше (загальне) повідомлення з overview
    const overviewLines: string[] = [];
    overviewLines.push(`🤖 <b>Підсумок дня — потенційні задачі</b>\n`);
    overviewLines.push(`За день я помітив <b>${inserted}</b> ${inserted === 1 ? "можливу задачу" : "можливі задачі"} що не оформлені у Tasks.`);
    overviewLines.push(`Розбив на ${totalBatches} ${totalBatches === 1 ? "повідомлення" : "повідомлень"} по ${BATCH_SIZE} задач — кнопки нижче.\n`);
    overviewLines.push(`⚠ Натискати кнопки можуть тільки <b>CEO</b> або <b>COO</b>.`);
    await tgSendMessage(chat.chat_id, overviewLines.join("\n"), null);

    // Батчі
    for (let b = 0; b < totalBatches; b++) {
      const batch = summary.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      const startIdx = b * BATCH_SIZE;
      const lines: string[] = [];
      lines.push(`📋 <b>Блок ${b + 1}/${totalBatches}</b> · задачі ${startIdx + 1}–${startIdx + batch.length}\n`);
      batch.forEach((s, idx) => {
        const realIdx = startIdx + idx + 1;
        const ass = s.assignee_name ? ` <i>(${escHtml(s.assignee_name)})</i>` : " <i>(не визначено)</i>";
        // 08.06.2026 NEW (Давид): індикатор 📎 коли attached files
        const att = s.attachments_count && s.attachments_count > 0
          ? ` 📎${s.attachments_count}` : "";
        lines.push(`<b>${realIdx}.</b> ${escHtml(s.title)}${ass}${att}`);
      });
      // 08.06.2026 NEW (Давид): 3 кнопки на задачу — ✅ Створити, 👤 Змінити виконавця, ❌
      // Раніше 2 кнопки: accept/dismiss. Додано inline 👤 щоб не ходити у DM edit-flow
      // коли AI неправильно визначив assignee.
      const keyboard = batch.map((s, idx) => {
        const realIdx = startIdx + idx + 1;
        const assName = s.assignee_name || "не визначено";
        return [
          { text: `${realIdx}. ${s.title.slice(0, 20)} ✅`, callback_data: `taskprop:accept:${s.proposed_id}` },
          { text: `👤 ${assName.slice(0, 12)}`, callback_data: `taskprop:assign_inline:${s.proposed_id}` },
          { text: "❌", callback_data: `taskprop:dismiss:${s.proposed_id}` },
        ];
      });
      await tgSendMessage(chat.chat_id, lines.join("\n"), keyboard);
      // Маленьку паузу між batch, щоб TG не rate-limit
      await new Promise(r => setTimeout(r, 250));
    }
  }

  return { chat_id: chat.chat_id, proposed_count: inserted };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // Load whitelisted chats з proactive=true
    const { data: chats } = await supabase
      .from("tg_listening_chats")
      .select("chat_id, chat_title, default_assignee_id, proactive")
      .eq("proactive", true);

    if (!chats || chats.length === 0) {
      return new Response(JSON.stringify({ ok: true, msg: "no proactive chats" }), { status: 200 });
    }

    // Load active team members
    const { data: members } = await supabase
      .from("users")
      .select("id, name, tg_username, tg_chat_id, role, is_active")
      .eq("is_active", true);
    const teamMembers = (members || []) as UserRow[];

    const results = [];
    for (const c of chats) {
      try {
        const res = await scanChat(supabase, c, teamMembers);
        results.push(res);
      } catch (e) {
        console.error("[scan]", c.chat_id, e);
        results.push({ chat_id: c.chat_id, proposed_count: 0, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[daily-scan] fatal:", e);
    return new Response(JSON.stringify({ ok: false, err: (e as Error).message }), { status: 500 });
  }
});
