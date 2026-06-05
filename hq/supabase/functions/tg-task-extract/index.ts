/* ============================================================================
   tg-task-extract — emoji-triggered task extraction from TG messages
   Sprint 1 of TG Task Bot (05.06.2026)
   ============================================================================

   Викликається з tg-webhook коли користувач реагує emoji 📌/📋/✅ на повідомлення
   у whitelisted чаті.

   Що робить:
   1. Викликає Claude Haiku 4.5 для парсингу повідомлення → структура задачі
   2. Резолвить assignee_hint → public.users.id
   3. INSERT у tg_proposed_tasks (state=proposed)
   4. Відправляє DM пропоновачу з proposal + 3 inline buttons

   Вхід:
   {
     source: "emoji" | "command",
     chat_id: number,            // groups: negative
     chat_title?: string,
     message_id: number,
     proposer_tg_id: number,     // TG id того хто додав emoji
     text: string,               // оригінальний текст повідомлення
     thread_context?: Array<{from: string, text: string}>
   }
============================================================================ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TG_BOT_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;
const TASKS_URL = Deno.env.get("TASKS_URL") || "https://team.dreamcar.ua/tasks";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

interface ExtractInput {
  source: "emoji" | "command";
  chat_id: number;
  chat_title?: string;
  message_id: number;
  proposer_tg_id: number;
  text: string;
  thread_context?: Array<{ from: string; text: string }>;
  // 05.06.2026: пряма передача mention info з tg-webhook entities
  mention_tg_user_id?: number;
  mention_username?: string;
}

interface ExtractedTask {
  is_task: boolean;
  title: string | null;
  description: string | null;
  assignee_hint: string | null;
  due_date: string | null;
  priority: "p1" | "p2" | "p3" | null;
  confidence: number;
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
// Claude Haiku extraction
// ---------------------------------------------------------------------
function buildSystemPrompt(today: string, teamMembers: UserRow[]): string {
  const memberList = teamMembers
    .map((u) => `- ${u.name || "?"}${u.tg_username ? " (@" + u.tg_username + ")" : ""}`)
    .join("\n");

  return `Ти — асистент-помічник української команди DreamCar.
Аналізуєш повідомлення у Telegram-чаті і визначаєш чи це постановка задачі.

ЩО Є ЗАДАЧЕЮ:
- Конкретна дія яку потрібно зробити людині
- Має дієслово в наказовому/майбутньому часі ("зроби", "треба", "доробити", "запусти", "перевір")
- Має чіткий результат що очікується

ЩО НЕ Є ЗАДАЧЕЮ:
- Питання про статус ("як справи з лендингом?")
- Обговорення без action item ("цікавий підхід...")
- Згадка вже зробленої роботи ("я закрив ту таску")
- Привітання, smalltalk

Сьогодні: ${today} (формат YYYY-MM-DD)

Команда DreamCar (assignee може бути одним з них):
${memberList}

ПРАВИЛА ВИТЯГНЕННЯ:

title:
- 60 символів максимум, у наказовій формі
- Без emoji, без зайвих слів

description:
- 250 символів максимум, додатковий контекст з повідомлення
- null якщо ясно лише з title

assignee_hint:
- Якщо знайдено імʼя зі списку команди — повертай саме як у списку (наприклад "Саша", "Артем")
- Якщо @username — повертай як "@username"
- null якщо явно не названо

due_date:
- Конвертуй у YYYY-MM-DD
- "сьогодні" → ${today}
- "завтра" → +1 день
- "до пʼятниці", "до понеділка" → найближча відповідна дата
- "до кінця тижня" → найближча неділя
- "до 10.06", "до 10 червня" → дата у поточному році або наступному якщо вже минула
- null якщо не вказано

priority:
- p1 (терміново): "терміново", "ASAP", "вчора треба було", "критично", "горить", "🔥"
- p2 (важливо): "важливо", "не забути", "обовʼязково"
- p3: дефолт

confidence:
- 0.0-1.0
- 0.9+: ясна задача з viewpoint
- 0.6-0.8: ймовірно задача, є невпевненість
- < 0.6: радше discussion або питання

Відповідай ЛИШЕ валідним JSON, без коментарів і markdown:
{
  "is_task": boolean,
  "title": string|null,
  "description": string|null,
  "assignee_hint": string|null,
  "due_date": string|null,
  "priority": "p1"|"p2"|"p3"|null,
  "confidence": number
}`;
}

async function extractWithClaude(input: ExtractInput, teamMembers: UserRow[]): Promise<ExtractedTask> {
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = buildSystemPrompt(today, teamMembers);

  let userText = `Повідомлення для аналізу:\n"${input.text}"`;
  if (input.thread_context && input.thread_context.length > 0) {
    userText += `\n\nКонтекст обговорення (попередні повідомлення):\n` +
      input.thread_context.slice(-5).map((m) => `${m.from}: ${m.text}`).join("\n");
  }
  userText += `\n\nПоверни структурований JSON.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 500,
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

  // Спробуємо знайти JSON блок
  let parsed: ExtractedTask;
  try {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : content);
  } catch (e) {
    console.error("Failed to parse Claude JSON:", content);
    throw new Error("LLM returned invalid JSON");
  }

  return parsed;
}

// ---------------------------------------------------------------------
// Resolve assignee_hint → user_id
// Підтримує patterns: "Саша", "@username", "Давид (@username)", "Name @user"
// ---------------------------------------------------------------------
function resolveAssignee(hint: string | null, members: UserRow[]): string | null {
  if (!hint) return null;
  const raw = hint.trim();

  // Збираємо кандидатів у порядку від найбільш специфічних до загальніших:
  const candidates: string[] = [];
  // 1. @username з тексту (якщо є)
  const atMatches = raw.match(/@([a-zA-Z0-9_]+)/g);
  if (atMatches) for (const m of atMatches) candidates.push(m); // "@some_mario"
  // 2. Перше слово (часто це ім'я перед дужкою/коми)
  const firstWord = raw.split(/[\s,()\[\]]+/).filter(Boolean)[0];
  if (firstWord && !candidates.includes(firstWord)) candidates.push(firstWord);
  // 3. Уся строка як остання спроба
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
  chatId: number | string,
  text: string,
  inlineKeyboard?: Array<Array<Record<string, string>>>,
  opts?: { reply_to_message_id?: number },
): Promise<{ message_id?: number; ok: boolean; err?: string }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  if (opts?.reply_to_message_id) {
    body.reply_to_message_id = opts.reply_to_message_id;
    body.allow_sending_without_reply = true;
  }
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

function formatProposalText(
  proposed: {
    title: string;
    description: string | null;
    assignee_id: string | null;
    assignee_hint: string | null;
    due_date: string | null;
    priority: string | null;
    confidence: number;
  },
  assigneeName: string | null,
  chatTitle: string,
  sourceText: string,
  isGroup: boolean = false,
): string {
  const lines = [];
  if (isGroup) {
    // У групі — лаконічніше, без чату назви (усі тут)
    lines.push(`🤖 <b>Зловив можливу задачу</b> — погоджуємо?\n`);
  } else {
    lines.push(`🤖 <b>Знайшов можливу задачу</b> у чаті <i>${escHtml(chatTitle)}</i>\n`);
  }
  lines.push(`📌 <b>Заголовок:</b> ${escHtml(proposed.title)}`);
  if (proposed.description) {
    lines.push(`📝 ${escHtml(proposed.description)}`);
  }
  if (proposed.assignee_id) {
    lines.push(`👤 <b>Виконавець:</b> ${escHtml(assigneeName || "?")}`);
  } else if (proposed.assignee_hint) {
    lines.push(`👤 <b>Виконавець:</b> ${escHtml(proposed.assignee_hint)} <i>(не зміг звʼязати з юзером)</i>`);
  }
  if (proposed.due_date) {
    lines.push(`📅 <b>Дедлайн:</b> ${proposed.due_date.split("-").reverse().join(".")}`);
  }
  if (proposed.priority) {
    const map = { p1: "🔴 P1 (терміново)", p2: "🟡 P2 (важливо)", p3: "🔵 P3 (звичайний)" };
    lines.push(`<b>Пріоритет:</b> ${map[proposed.priority as keyof typeof map] || proposed.priority}`);
  }
  if (!isGroup) {
    // У DM показуємо контекст — у group це reply на сам контекст, не треба дублювати
    lines.push(`\n💡 <i>Контекст:</i> "${escHtml(sourceText.slice(0, 200))}${sourceText.length > 200 ? "..." : ""}"`);
  }
  lines.push(`\nConfidence: ${(proposed.confidence * 100).toFixed(0)}%`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let input: ExtractInput;
  try {
    input = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, err: "bad_json" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // 1. Verify chat is whitelisted
    const { data: chat } = await supabase
      .from("tg_listening_chats")
      .select("chat_id, chat_title, reactive, default_assignee_id")
      .eq("chat_id", input.chat_id)
      .maybeSingle();
    if (!chat) {
      return new Response(JSON.stringify({ ok: false, err: "chat_not_whitelisted", chat_id: input.chat_id }), { status: 403 });
    }
    if (input.source === "emoji" && !chat.reactive) {
      return new Response(JSON.stringify({ ok: false, err: "reactive_disabled" }), { status: 403 });
    }

    // 2. Resolve proposer
    const { data: proposer } = await supabase
      .from("users")
      .select("id, name, tg_chat_id")
      .eq("tg_chat_id", String(input.proposer_tg_id))
      .maybeSingle();
    if (!proposer) {
      return new Response(JSON.stringify({ ok: false, err: "proposer_not_in_users", tg_id: input.proposer_tg_id }), { status: 403 });
    }

    // 3. Load active team members for assignee resolution
    const { data: members } = await supabase
      .from("users")
      .select("id, name, tg_username, tg_chat_id, role, is_active")
      .eq("is_active", true);
    const teamMembers = (members || []) as UserRow[];

    // 4. Extract via Claude
    const extracted = await extractWithClaude(input, teamMembers);

    if (!extracted.is_task || !extracted.title || extracted.confidence < 0.4) {
      return new Response(JSON.stringify({
        ok: true,
        is_task: false,
        confidence: extracted.confidence,
        msg: "Not a task per LLM",
      }), { status: 200 });
    }

    // 5. Resolve assignee — пріоритет:
    //    a) mention_tg_user_id з TG entities (text_mention) — найвищий, бо direct user.id
    //    b) mention_username з TG entities — резолв через tg_username
    //    c) Claude's assignee_hint — fallback через name/username match
    //    d) chat default_assignee_id
    let assigneeId: string | null = null;
    let assigneeSource = "none";
    if (input.mention_tg_user_id) {
      const found = teamMembers.find((u) => u.tg_chat_id === String(input.mention_tg_user_id));
      if (found) { assigneeId = found.id; assigneeSource = "text_mention"; }
    }
    if (!assigneeId && input.mention_username) {
      const norm = input.mention_username.toLowerCase().replace(/^@/, "").trim();
      const found = teamMembers.find((u) => u.tg_username && u.tg_username.toLowerCase() === norm);
      if (found) { assigneeId = found.id; assigneeSource = "mention"; }
    }
    if (!assigneeId) {
      assigneeId = resolveAssignee(extracted.assignee_hint, teamMembers);
      if (assigneeId) assigneeSource = "claude_hint";
    }
    if (!assigneeId && chat.default_assignee_id) {
      assigneeId = chat.default_assignee_id;
      assigneeSource = "chat_default";
    }
    const assigneeName = assigneeId ? teamMembers.find((u) => u.id === assigneeId)?.name || null : null;
    console.log("[extract] assignee resolved:", { assigneeId, assigneeName, source: assigneeSource });

    // 6. INSERT proposed task
    const { data: proposed, error: insErr } = await supabase
      .from("tg_proposed_tasks")
      .insert({
        state: "proposed",
        source: input.source,
        chat_id: input.chat_id,
        message_id: input.message_id,
        proposer_id: proposer.id,
        source_text: input.text,
        title: extracted.title,
        description: extracted.description,
        assignee_hint: extracted.assignee_hint,
        assignee_id: assigneeId,
        due_date: extracted.due_date,
        priority: extracted.priority,
        confidence: extracted.confidence,
      })
      .select("id")
      .single();

    if (insErr || !proposed) {
      console.error("Insert error:", insErr);
      return new Response(JSON.stringify({ ok: false, err: "insert_failed", details: insErr?.message }), { status: 500 });
    }

    // 7. Send proposal — у group чат (як reply на джерело) АБО у DM proposer
    // Group chat у TG має negative chat_id; DM — positive
    const isGroupChat = input.chat_id < 0;
    let targetChatId: number;
    let replyToMsgId: number | undefined = undefined;
    if (isGroupChat) {
      // У групу — відповідь на оригінальне повідомлення
      targetChatId = input.chat_id;
      replyToMsgId = input.message_id;
    } else {
      // У DM proposer'у
      if (!proposer.tg_chat_id) {
        return new Response(JSON.stringify({ ok: true, proposed_id: proposed.id, warn: "proposer_no_tg" }), { status: 200 });
      }
      targetChatId = Number(proposer.tg_chat_id);
    }

    const proposalText = formatProposalText(
      {
        title: extracted.title,
        description: extracted.description,
        assignee_id: assigneeId,
        assignee_hint: extracted.assignee_hint,
        due_date: extracted.due_date,
        priority: extracted.priority,
        confidence: extracted.confidence,
      },
      assigneeName,
      chat.chat_title || "Невідомий чат",
      input.text,
      isGroupChat, // для group — скоротити preamble (всі вже у чаті)
    );

    const keyboard = [
      [
        { text: "✅ Створити", callback_data: `taskprop:accept:${proposed.id}` },
        { text: "✏ Змінити", callback_data: `taskprop:edit:${proposed.id}` },
      ],
      [
        { text: "❌ Не задача", callback_data: `taskprop:dismiss:${proposed.id}` },
      ],
    ];

    const sendRes = await tgSendMessage(
      targetChatId,
      proposalText,
      keyboard,
      replyToMsgId ? { reply_to_message_id: replyToMsgId } : undefined,
    );
    if (sendRes.ok && sendRes.message_id) {
      await supabase
        .from("tg_proposed_tasks")
        .update({
          dm_chat_id: targetChatId,
          dm_message_id: sendRes.message_id,
        })
        .eq("id", proposed.id);
    } else {
      console.warn("TG send failed:", sendRes.err);
    }

    return new Response(JSON.stringify({
      ok: true,
      proposed_id: proposed.id,
      is_task: true,
      confidence: extracted.confidence,
      title: extracted.title,
      dm_sent: sendRes.ok,
    }), { status: 200, headers: { "content-type": "application/json" } });

  } catch (e) {
    console.error("tg-task-extract error:", e);
    return new Response(JSON.stringify({ ok: false, err: (e as Error).message }), { status: 500 });
  }
});
