// =====================================================================
// DreamCar HQ — TG AI Router
// =====================================================================
// Викликається з tg-webhook (forwardToAI) коли користувач пише у DM
// бота @dreamcar_team_bot текст БЕЗ команди, або шле voice.
//
// Payload (POST JSON):
//   {
//     chat_id: number,            // TG chat_id (== user_id для DM)
//     user_db_id: string | null,  // public.users.id, якщо забіндений
//     user_name: string,          // ім'я для звертання
//     user_role: string,          // ceo / coo / lead / member / designer
//     text: string | undefined,   // текстове повідомлення
//     voice_file_id: string | undefined,  // file_id голосового
//     message_id: number          // для reply
//   }
//
// Робить:
//   1. Якщо voice_file_id — транскрибує через Whisper (OPENAI_API_KEY)
//   2. Викликає Claude (ANTHROPIC_API_KEY) з system prompt про DreamCar
//   3. Шле відповідь у TG (TG_BOT_TOKEN) reply_to_message_id
//
// Завжди повертає 200 щоб не блокувати webhook. Логуємо помилки.
// =====================================================================

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API_KEY")    ?? "";
const TG_BOT_TOKEN  = Deno.env.get("TG_BOT_TOKEN")      ?? "";
const MODEL         = Deno.env.get("ANTHROPIC_MODEL")   ?? "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SYSTEM_PROMPT =
  "Ти AI асистент команди DreamCar. Допомагаєш членам команди з питаннями про публікації, " +
  "задачі, бренд. Відповідай українською, дружньо, коротко. Якщо питання не про роботу — " +
  "м'яко повертай у контекст.\n\n" +
  "Контекст про DreamCar: українська платформа, де люди отримують доступ до AI-сервісу та " +
  "паралельно беруть участь у проєктах з автомобілями мрії. 16+ авто переїхало до власників " +
  "за 6 років. Активна аудиторія 30-40 тис. Активний проект — BMW X5 Hybrid (фінал 19.04.2026).\n\n" +
  "Системи команди:\n" +
  "• HQ (hq.dreamcar.ua) — публікації, погодження, календар SMM\n" +
  "• Tasks (tasks.dreamcar.ua) — задачі команди\n" +
  "• Brand Book (brand.dreamcar.ua) — гайдлайни\n" +
  "• Onboarding (dreamcar.ua/onboarding) — старт для нових\n\n" +
  "Тон: дружній, без пафосу, без emoji-перевантаження. Звертайся на «ти». " +
  "ЗАБОРОНЕНО у відповідях про DreamCar: «лотерея», «розіграш», «квиток», «приз» — " +
  "юридичні ризики. Замість них: «нагорода», «учасник», «AI-токени», «спільнота».";

// ---------------------- Telegram helpers ----------------------

async function tgSend(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
  if (!TG_BOT_TOKEN) {
    console.error("TG_BOT_TOKEN missing — cannot send reply");
    return;
  }
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyToMessageId) {
    body.reply_parameters = { message_id: replyToMessageId, allow_sending_without_reply: true };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error(`TG send fail ${r.status}: ${errText}`);
    }
  } catch (e) {
    console.error("TG send threw:", e);
  }
}

async function tgGetFile(fileId: string): Promise<string | null> {
  if (!TG_BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!r.ok) {
      console.error(`getFile fail ${r.status}: ${await r.text()}`);
      return null;
    }
    const data = await r.json();
    const path = data?.result?.file_path;
    if (!path) return null;
    return `https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${path}`;
  } catch (e) {
    console.error("tgGetFile threw:", e);
    return null;
  }
}

// ---------------------- OpenAI Whisper (voice STT) ----------------------

async function transcribeVoice(fileUrl: string): Promise<string | null> {
  if (!OPENAI_KEY) {
    console.error("OPENAI_API_KEY missing — cannot transcribe voice");
    return null;
  }
  try {
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) {
      console.error(`Voice download fail ${fileResp.status}`);
      return null;
    }
    const buf = await fileResp.arrayBuffer();

    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/ogg" }), "voice.ogg");
    form.append("model", "whisper-1");
    form.append("language", "uk");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}` },
      body: form,
    });
    if (!r.ok) {
      console.error(`Whisper fail ${r.status}: ${await r.text()}`);
      return null;
    }
    const data = await r.json();
    return data?.text || null;
  } catch (e) {
    console.error("transcribeVoice threw:", e);
    return null;
  }
}

// ---------------------- Claude (Anthropic) ----------------------

async function callClaude(userText: string, userName: string, userRole: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing");

  const userBlock = `Користувач: ${userName} (роль: ${userRole}).\nЗапитання: ${userText}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userBlock }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const text = data?.content?.[0]?.text || "";
  return text.trim() || "(порожня відповідь — спробуй переформулювати)";
}

// ---------------------- Handler ----------------------

interface Payload {
  chat_id: number;
  user_db_id?: string | null;
  user_name?: string;
  user_role?: string;
  text?: string;
  voice_file_id?: string;
  message_id?: number;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  let body: Payload;
  try {
    body = await req.json() as Payload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const chatId = body.chat_id;
  if (!chatId) {
    return new Response(JSON.stringify({ ok: false, error: "chat_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userName = body.user_name || "друг";
  const userRole = body.user_role || "member";
  const replyTo  = body.message_id;

  try {
    // 1. Отримуємо текст: або прямий, або з voice → Whisper
    let userText = (body.text || "").trim();

    if (!userText && body.voice_file_id) {
      if (!OPENAI_KEY) {
        await tgSend(chatId,
          "🎙️ Голосові поки не підтримуються (OPENAI_API_KEY не налаштовано). Напиши текстом, будь ласка.",
          replyTo);
        return new Response(JSON.stringify({ ok: true, reason: "no-openai-key" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const fileUrl = await tgGetFile(body.voice_file_id);
      if (!fileUrl) {
        await tgSend(chatId, "⚠️ Не зміг завантажити голосове. Спробуй ще раз або напиши текстом.", replyTo);
        return new Response(JSON.stringify({ ok: true, reason: "tg-getfile-fail" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const transcript = await transcribeVoice(fileUrl);
      if (!transcript) {
        await tgSend(chatId, "⚠️ Не вдалось розпізнати голосове. Спробуй ще раз або напиши текстом.", replyTo);
        return new Response(JSON.stringify({ ok: true, reason: "whisper-fail" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userText = transcript;
      // Дзеркалимо назад транскрипт щоб користувач бачив що почули
      await tgSend(chatId, `🎙️ <i>Почув:</i> ${esc(transcript)}`, replyTo);
    }

    if (!userText) {
      await tgSend(chatId, "🤔 Порожнє повідомлення. Напиши питання текстом або голосовим.", replyTo);
      return new Response(JSON.stringify({ ok: true, reason: "empty" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Викликаємо Claude
    const reply = await callClaude(userText, userName, userRole);

    // 3. Шлемо назад у TG. HTML-escape бо parse_mode=HTML.
    await tgSend(chatId, esc(reply), replyTo);

    return new Response(JSON.stringify({ ok: true, model: MODEL }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errMsg = String((e as Error).message || e);
    console.error("tg-ai-router error:", errMsg);
    // Завжди намагаємось щось сказати юзеру — інакше DM мовчить
    await tgSend(chatId,
      "⚠️ AI асистент тимчасово недоступний. Спробуй за хвилину або напиши Вадиму.",
      replyTo);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), {
      status: 200, // 200 щоб webhook не ретраїв
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
