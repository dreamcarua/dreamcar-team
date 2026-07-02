// =====================================================================
// DreamCar HQ — AI Copy Assistant (Anthropic Claude)
// =====================================================================
// Edge Function приймає brief із картки публікації, складає prompt
// з урахуванням платформи + brand voice + AUDIENCE портрета,
// викликає Claude API і повертає згенерований текст + hashtags.
//
// Запит:
//   POST /ai-copy-assistant
//   { brand: "dreamcar" | "sneco" | "abrisart" | "barpi",
//     platform: "ig" | "tg" | "tt" | "yt" | "fb" | "th",
//     brief: "коротко про що пост",
//     title: "опційний заголовок",
//     tone: "casual" | "expert" | "playful" | "salesy",
//     length: "short" | "medium" | "long",
//     examples: ["опційно — посилання на референси"]
//   }
//
// Secrets:
//   ANTHROPIC_API_KEY, HQ_AI_SECRET (опційно)
// =====================================================================

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const HQ_AI_SECRET  = Deno.env.get("HQ_AI_SECRET") ?? "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-hq-ai-secret",
};

const BRANDS: Record<string, { voice: string; rules: string; examples: string; audience: string }> = {
  dreamcar: {
    voice:
      "DreamCar — це українська платформа, де люди отримують доступ до AI-сервісу й паралельно беруть участь у проєктах з автомобілями мрії. " +
      "За 6 років 16+ авто переїхало до своїх нових власників, аудиторія — 30-40 тис активних учасників. " +
      "Тон: натхненний, людяний, без надмірного хайпу. Говоримо про мрію, спільноту, реальність нагороди.",
    audience:
      "Ядро ЦА (на основі опитування 999 учасників 2026): " +
      "переважно чоловіки 28-45 років, мешканці великих та середніх міст України, " +
      "захоплюються автомобілями, технологіями, активно стежать за новинами AI. " +
      "Працюють у малому/середньому бізнесі, IT, фрилансі. " +
      "Мотивація: 60% — мрія про якісне авто, 25% — інтерес до AI-сервісу, 15% — підтримка українського продукту. " +
      "Прийнятна ціна входу — 100-500 грн/мес. " +
      "Бажані призи: Audi, BMW, Tesla, Porsche. " +
      "Канали: Instagram (60% активних), Telegram (35%), TikTok (зростає).",
    rules:
      "ЗАБОРОНЕНО використовувати слова: «шанс», «квиток», «лотерея», «розіграш», «приз» — у юридичному значенні. " +
      "Замість них: «учасник», «отримати авто», «AI-токени», «спільнота DreamCar», «нагорода». " +
      "Завжди підкреслюй: люди купляють токени AI-сервісу, авто — приємний бонус для активних учасників. " +
      "Без обіцянок гарантованого результату. " +
      "Українська мова. Уникай канцеляризмів. Короткі речення. " +
      "Звертайся на «ти» — це спільнота, а не корпорація.",
    examples:
      "✓ «Сьогодні з нами в команді — ще +200 нових учасників. Вітаємо!» " +
      "✓ «Audi e-tron уже в гаражі переможця цього сезону.» " +
      "✓ «100 грн = 50 AI-токенів + можливість отримати авто. Інтегруй розум, не лотерею.» " +
      "✗ «Виграй авто!» (заборонено) " +
      "✗ «Гарантуємо результат» (заборонено)",
  },
  sneco: {
    voice:
      "snEco — український виробник хрустких сирних снеків на основі патентованої технології мікрохвильово-вакуумної сушки. " +
      "Лауреат SIAL Innovation Grand Prix 2024 у Парижі. Сертифікати FSSC 22000, ISO 22000. " +
      "Тон: премʼюм-якість, інновація, без пафосу. Український продукт світового рівня.",
    audience:
      "Здорове харчування, ЗОЖ, гастро-ентузіасти, мами з дітьми, експортні B2B-клієнти ЄС.",
    rules:
      "НЕ використовувати «NASA» у будь-якому контексті — у нас власна патентована технологія. " +
      "Завжди підкреслюй: натуральний продукт, без консервантів, без масла, без панірування. " +
      "Eкологічно — перший еко-снек в Україні. Українська або англійська залежно від ринку.",
    examples:
      "✓ «100% сир. Жодного грама зайвого.» " +
      "✓ «Грав Париж — і нагородив нас Grand Prix.» " +
      "✗ «Технологія NASA» (заборонено)",
  },
  abrisart: {
    voice:
      "Abris Art — український виробник наборів для рукоділля (вишивка бісером, хрестиком, стрінг-арт, малювання за номерами). " +
      "3500+ товарів, експорт у 20+ країн. Найстабільніший проект групи. " +
      "Тон: теплий, ремісничий, з повагою до творчого процесу. Без зайвої гламурності.",
    audience: "Жінки 35-65, рукодільниці, любителі hand-made, експортні ринки ЄС, США, Канада.",
    rules:
      "Українська або англійська залежно від ринку. " +
      "Завжди показуй процес або готову роботу. " +
      "Не використовуй слова «легко», «швидко» — рукоділля це повільна радість.",
    examples:
      "✓ «Кожна намистинка — ще один крок до вашої картини.» " +
      "✓ «Триста годин роботи. Один шедевр.»",
  },
  barpi: {
    voice:
      "Barpi — натуральні снеки для тварин (собаки і коти) на основі snEco-технології вакуумної сушки. " +
      "Український ринок зараз, далі — міжнародна експансія. " +
      "Тон: турботливий, простий, з любовʼю до тварин. Без надмірної інфантильності.",
    audience: "Власники собак і котів 25-50, премʼюм-сегмент, ветлікарі, зоомагазини.",
    rules:
      "100% натуральне м'ясо/риба, без консервантів. Безпечно для будь-якого віку тварини. " +
      "Українська мова. Короткі речення.",
    examples:
      "✓ «Барпі — це просто м'ясо. Все.» " +
      "✓ «Твій кіт перевірить — і вибере знову.»",
  },
};

const PLATFORM_RULES: Record<string, { name: string; constraints: string; cta: string }> = {
  ig: { name: "Instagram", constraints: "До 2200 символів. 5-10 хештегів. Емодзі — помірно. Перший рядок = hook (до 125 символів).", cta: "Прокоментуй / Збережи / Поділись" },
  tg: { name: "Telegram", constraints: "До 4096 символів. HTML-розмітка <b>/<i>. Жодних хештегів усередині. Перший рядок — хук.", cta: "Реакція / Поділись із друзями" },
  tt: { name: "TikTok", constraints: "Caption до 2200 символів. 3-5 хештегів. Хук у перші 2 секунди — текст має бути коротким.", cta: "Залишай коментар / Лайк" },
  yt: { name: "YouTube Shorts", constraints: "Title до 60 символів. Description 100-200 символів з посиланнями. 2-3 хештеги.", cta: "Підпишись / Лайк" },
  fb: { name: "Facebook", constraints: "До 63206 символів, але оптимально 100-250. 1-2 хештеги максимум. Тон — більш дорослий.", cta: "Поділись / Збережи" },
  th: { name: "Threads", constraints: "До 500 символів. Conversational tone. 0-2 хештеги.", cta: "Реплай / Repost" },
};

const TONE_LABELS: Record<string, string> = {
  casual: "невимушений, дружній",
  expert: "експертний, авторитетний",
  playful: "грайливий, з гумором",
  salesy: "продажний, чітке call-to-action",
};

const LENGTH_TARGETS: Record<string, string> = {
  short:  "60-120 слів",
  medium: "150-250 слів",
  long:   "300-450 слів",
};

function buildPrompt(input: {
  brand: string; platform: string; brief: string; title?: string;
  tone?: string; length?: string; examples?: string[];
}): string {
  const brand = BRANDS[input.brand] || BRANDS.dreamcar;
  const plat = PLATFORM_RULES[input.platform] || PLATFORM_RULES.ig;
  const tone = TONE_LABELS[input.tone || "casual"];
  const len = LENGTH_TARGETS[input.length || "medium"];
  const examplesBlock = (input.examples && input.examples.length)
    ? `\n\nРеференси:\n${input.examples.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
    : "";

  return `Ти — досвідчений SMM-копірайтер. Напиши пост для соцмережі.

ПЛАТФОРМА: ${plat.name}
ОБМЕЖЕННЯ: ${plat.constraints}

БРЕНД-ВОЙС:
${brand.voice}

ЦІЛЬОВА АУДИТОРІЯ:
${brand.audience}

ОБОВ'ЯЗКОВІ ПРАВИЛА:
${brand.rules}

ПРИКЛАДИ (наслідуй стиль):
${brand.examples}

ТОН: ${tone}
ДОВЖИНА: ${len}
${input.title ? `ЗАГОЛОВОК (для контексту): ${input.title}` : ""}

ЗАВДАННЯ:
${input.brief}${examplesBlock}

ФОРМАТ ВІДПОВІДІ (строго JSON, без markdown, без коментарів):
{
  "text": "повний текст поста готовий до публікації (з емодзі, переносами рядків як \\n)",
  "hashtags": ["#тег1", "#тег2"],
  "cta": "коротке call-to-action одним реченням"
}

Поверни ТІЛЬКИ JSON, нічого більше.`;
}

async function callClaude(prompt: string): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text || "";
  return {
    text,
    tokensIn: data.usage?.input_tokens || 0,
    tokensOut: data.usage?.output_tokens || 0,
  };
}

function parseJsonResponse(raw: string): { text: string; hashtags: string[]; cta: string } {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { text: raw, hashtags: [], cta: "" };
  }
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    return {
      text: obj.text || raw,
      hashtags: Array.isArray(obj.hashtags) ? obj.hashtags : [],
      cta: obj.cta || "",
    };
  } catch {
    return { text: raw, hashtags: [], cta: "" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  if (HQ_AI_SECRET) {
    const got = req.headers.get("x-hq-ai-secret");
    if (got !== HQ_AI_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing in secrets" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response("Invalid JSON", { status: 400, headers: corsHeaders }); }

  if (!body.brief) {
    return new Response(JSON.stringify({ error: "brief is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const prompt = buildPrompt({
      brand: String(body.brand || "dreamcar"),
      platform: String(body.platform || "ig"),
      brief: String(body.brief),
      title: body.title ? String(body.title) : undefined,
      tone: body.tone ? String(body.tone) : undefined,
      length: body.length ? String(body.length) : undefined,
      examples: Array.isArray(body.examples) ? (body.examples as string[]) : undefined,
    });

    const claudeResp = await callClaude(prompt);
    const parsed = parseJsonResponse(claudeResp.text);

    return new Response(JSON.stringify({
      ok: true,
      text: parsed.text,
      hashtags: parsed.hashtags,
      cta: parsed.cta,
      model: MODEL,
      tokens_in: claudeResp.tokensIn,
      tokens_out: claudeResp.tokensOut,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-copy-assistant error:", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
