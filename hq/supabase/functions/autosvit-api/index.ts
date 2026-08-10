// «Автосвіт» :: API v2.1 — + exemplar-capture: суттєві правки зі сторінки стають еталонами голосу при approve

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const DESK = "11111111-1111-1111-1111-111111111111";
const CEO_ID = "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FN = `${SB_URL}/functions/v1`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  "Access-Control-Allow-Origin": "https://team.dreamcar.ua",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};
const JH = { ...CORS, "Content-Type": "application/json" };
const out = (o: any, code = 200) => new Response(JSON.stringify(o), { status: code, headers: JH });

const BLOCK = ["розігра", "лотере", "квиток", "квитк", "вигра", "джекпот", "азартн", "тоталізатор", "ставку на", "казино", "білет"];
const WARN = ["шанс", "приз", "переможц", "переможець", "фортун", "щаслив", "гарантован"];
function fullText(i: any): string {
  const frames = Array.isArray(i.script_video) ? i.script_video.map((f: any) => `${f.frame || ""} ${f.vo || ""}`).join("\n") : "";
  const slides = Array.isArray(i.slides) ? i.slides.map((s: any) => `${s.title || ""} ${s.text || ""}`).join("\n") : "";
  const tags = Array.isArray(i.hashtags) ? i.hashtags.join(" ") : "";
  return [i.title, i.hook, i.hook_alt, i.body_ig, i.body_tg, i.body_th, i.first_frame_tt, frames, slides, tags].filter(Boolean).join("\n");
}
const lex = (t: string) => { const s = (t || "").toLowerCase(); return { block: BLOCK.filter((w) => s.includes(w)), warn: WARN.filter((w) => s.includes(w)) }; };

function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) { console.error(`sb ${path.split("?")[0]} ${r.status}: ${t.slice(0, 300)}`); throw new Error("db"); }
  return t ? JSON.parse(t) : null;
}

async function whoami(req: Request, body: any) {
  const svc = req.headers.get("x-hq-cron-secret");
  if (svc && CRON_SECRET && safeEq(svc, CRON_SECRET) && body.actor) {
    return { id: CEO_ID, name: String(body.actor).slice(0, 60), role: "service" };
  }
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+.+/i.test(auth)) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON || SB_KEY, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u?.id || !UUID.test(u.id)) return null;
  const rows = await sb(`users?auth_id=eq.${u.id}&select=id,name,role&limit=1`);
  return rows?.[0] || null;
}

function kyivOffMin(ms: number): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", timeZoneName: "longOffset" })
    .formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || "GMT+03:00";
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 180;
}
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
function slotCandidates(dow: number | null): string[] {
  const target = dow && dow >= 1 && dow <= 7 ? dow : 3;
  const outArr: string[] = [];
  for (let add = 1; add <= 21 && outArr.length < 4; add++) {
    const guess = Date.now() + add * 864e5;
    const wd = WD[new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", weekday: "short" }).format(new Date(guess))];
    if (wd !== target) continue;
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(guess));
    const [Y, M, D] = ymd.split("-").map(Number);
    for (const h of [12, 18]) {
      const utcGuess = Date.UTC(Y, M - 1, D, h, 0, 0);
      outArr.push(new Date(utcGuess - kyivOffMin(utcGuess) * 60000).toISOString());
    }
  }
  return outArr.length ? outArr : [new Date(Date.now() + 864e5).toISOString()];
}
async function freeSlot(dow: number | null): Promise<string> {
  for (const c of slotCandidates(dow)) {
    const taken = await sb(`publications?publish_at=eq.${encodeURIComponent(c)}&desk_id=eq.${DESK}&deleted_at=is.null&select=id&limit=1`);
    if (!taken?.length) return c;
  }
  return slotCandidates(dow)[0];
}

async function callFn(name: string, body: any) {
  const r = await fetch(`${FN}/${name}`, { method: "POST", headers: { "Content-Type": "application/json", "x-hq-cron-secret": CRON_SECRET }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return out({ error: "POST only" }, 405);
  if (!CRON_SECRET) return out({ error: "config" }, 500);

  let b: any = {};
  try { b = await req.json(); } catch { return out({ error: "bad json" }, 400); }
  const action = String(b.action || "");

  try {
    if (action === "board") {
      const [rubrics, leads, ideas, sources] = await Promise.all([
        sb("autosvit_rubrics?select=*&order=sort_order"),
        sb("autosvit_leads?status=in.(new,matched)&select=*&order=score.desc,created_at.desc&limit=60"),
        sb("autosvit_ideas?status=in.(draft,sent,rework,approved,published)&select=*&order=created_at.desc&limit=80"),
        sb("autosvit_sources?select=slug,name,url,category,region,priority,active,last_fetch_at,last_fetch_note&order=priority.desc"),
      ]);
      const me = await whoami(req, b).catch(() => null);
      return out({ ok: true, rubrics, leads, ideas, sources, me: me && me.role !== "service" ? me : null });
    }

    const me = await whoami(req, b);
    if (!me) return out({ error: "Потрібен вхід. Увійди в HQ — сесія підхопиться сама." }, 401);
    const now = new Date().toISOString();
    const canDecide = ["ceo", "coo", "lead", "service"].includes(me.role);
    const needsId = ["save", "rework", "kill", "approve", "lead_reject"].includes(action);
    if (needsId && !UUID.test(String(b.id || ""))) return out({ error: "bad id" }, 400);

    if (action === "save") {
      const patch: any = {};
      for (const k of ["title", "hook", "hook_alt", "body_ig", "body_tg", "body_th", "first_frame_tt"]) if (typeof b[k] === "string") patch[k] = b[k].slice(0, 4000);
      if (!Object.keys(patch).length) return out({ error: "немає що зберігати" }, 400);
      const cur = (await sb(`autosvit_ideas?id=eq.${b.id}&select=*`))?.[0];
      if (!cur) return out({ error: "не знайдено" }, 404);
      const l = lex(fullText({ ...cur, ...patch }));
      const bigEdit = typeof patch.body_ig === "string" && cur.body_ig && Math.abs(patch.body_ig.length - cur.body_ig.length) > cur.body_ig.length * 0.1;
      patch.checks = { ...(cur.checks || {}), legal_block: l.block, legal_warn: l.warn, edited_by: me.name, edited_at: now, big_edit: bigEdit || (cur.checks || {}).big_edit || false };
      if (l.block.length) patch.status = "rework";
      else if (cur.status === "rework") patch.status = "draft";
      const upd = await sb(`autosvit_ideas?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      return out({ ok: true, idea: upd?.[0], legal_block: l.block, legal_warn: l.warn });
    }

    if (action === "rework" || action === "kill") {
      if (action === "kill" && !canDecide) return out({ error: "Недостатньо прав (потрібен lead+)" }, 403);
      const st = action === "kill" ? "killed" : "rework";
      const cur = (await sb(`autosvit_ideas?id=eq.${b.id}&select=checks`))?.[0];
      if (!cur) return out({ error: "не знайдено" }, 404);
      const upd = await sb(`autosvit_ideas?id=eq.${b.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: st, decided_by: me.name, decided_at: now, checks: { ...(cur.checks || {}), note: String(b.note || "").slice(0, 500) || null } }),
      });
      return out({ ok: true, idea: upd?.[0] });
    }

    if (action === "lead_reject") {
      await sb(`autosvit_leads?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected", updated_at: now }) });
      return out({ ok: true });
    }

    if (action === "approve") {
      if (!canDecide) return out({ error: "Недостатньо прав для апрува (потрібен lead+)" }, 403);
      const idea = (await sb(`autosvit_ideas?id=eq.${b.id}&select=*`))?.[0];
      if (!idea) return out({ error: "не знайдено" }, 404);
      if (idea.publication_id) return out({ ok: true, already: true, publication_id: idea.publication_id });
      const l = lex(fullText(idea));
      if (l.block.length) return out({ error: `Заборонена лексика: ${l.block.join(", ")}. Спершу виправ текст.` }, 400);

      const claimed = await sb(`autosvit_ideas?id=eq.${b.id}&publication_id=is.null&status=in.(draft,sent,rework)`, {
        method: "PATCH", body: JSON.stringify({ status: "approved", decided_by: me.name, decided_at: now }),
      });
      if (!claimed?.length) return out({ ok: true, already: true, note: "вже обробляється" });

      // суттєва правка зі сторінки + апрув = новий еталон голосу
      if (idea.checks?.edited_by && idea.checks?.big_edit && idea.body_ig) {
        await sb("autosvit_exemplars", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ source: "vadym_edit", text_body: idea.body_ig, metric_note: `правка ${idea.checks.edited_by}` }) }).catch(() => {});
      }

      const rub = (await sb(`autosvit_rubrics?slug=eq.${encodeURIComponent(idea.rubric_slug)}&select=*`))?.[0];
      const wantAt = typeof b.publish_at === "string" && !isNaN(Date.parse(b.publish_at)) && Date.parse(b.publish_at) > Date.now() ? new Date(b.publish_at).toISOString() : null;
      const publishAt = wantAt || await freeSlot(rub?.slot_dow ?? null);

      let textBody = idea.body_ig || idea.body_tg || "";
      if (["reels", "stories"].includes(rub?.content_type) && Array.isArray(idea.script_video) && idea.script_video.length) {
        textBody += "\n\n\u{1F3AC} Сценарій:\n" + idea.script_video.map((f: any) => `${f.sec}: ${f.frame} — ${f.vo}`).join("\n");
      }
      if (rub?.content_type === "carousel" && Array.isArray(idea.slides) && idea.slides.length) {
        textBody += "\n\n\u{1F4C4} Слайди:\n" + idea.slides.map((s: any) => `${s.n}. ${s.title} — ${s.text}`).join("\n");
      }

      const cleanTitle = String(idea.title || "").replace(new RegExp(`^${(rub?.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:·\\s—-]*`, "i"), "");
      const pub = (await sb("publications", {
        method: "POST",
        body: JSON.stringify({
          desk_id: DESK,
          title: `Автосвіт · ${rub?.name || idea.rubric_slug}: ${cleanTitle}`.slice(0, 240),
          publish_at: publishAt, content_type: rub?.content_type || "post",
          text_body: textBody, hashtags: idea.hashtags || [], status: "draft",
          created_by: me.id || CEO_ID,
        }),
      }))?.[0];

      const plats = [...new Set([...(rub?.platforms || ["ig", "tg"]), ...(idea.body_th ? ["th"] : [])])].filter((p: string) => ["ig", "tg", "tt", "th", "yt", "fb"].includes(p));
      if (plats.length) await sb("publication_platforms", { method: "POST", headers: { Prefer: "return=minimal,resolution=ignore-duplicates" }, body: JSON.stringify(plats.map((p: string) => ({ publication_id: pub.id, platform: p }))) }).catch(() => {});
      await sb("publication_responsibles", { method: "POST", headers: { Prefer: "return=minimal,resolution=ignore-duplicates" }, body: JSON.stringify([{ publication_id: pub.id, user_id: me.id || CEO_ID }]) }).catch(() => {});

      const upd = await sb(`autosvit_ideas?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify({ publication_id: pub.id }) });
      return out({ ok: true, idea: upd?.[0], publication_id: pub.id, publish_at: publishAt, platforms: plats });
    }

    if (action === "generate") {
      if (b.lead_id && !UUID.test(String(b.lead_id))) return out({ error: "bad lead_id" }, 400);
      const r = await callFn("autosvit-generate", { lead_id: b.lead_id, count: Math.min(parseInt(b.count, 10) || 3, 5), notify: b.notify !== false });
      return out({ ok: r.status === 200, ...r.body }, r.status === 200 ? 200 : 502);
    }
    if (action === "collect") {
      const r = await callFn("autosvit-collect", { per_source: Math.min(parseInt(b.per_source, 10) || 6, 12) });
      return out({ ok: r.status === 200, ...r.body }, r.status === 200 ? 200 : 502);
    }

    return out({ error: `unknown action` }, 400);
  } catch (e) {
    console.error("autosvit-api:", action, e);
    return out({ error: "internal" }, 500);
  }
});
