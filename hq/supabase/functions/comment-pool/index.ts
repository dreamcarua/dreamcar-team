// comment-pool v1.5 (16.11.2026): remove_draw (✗ = спроба зникає з журналу, учасник у skipped)
// Пул учасників з коментарів Instagram-поста @dreamcar.ua для сторінки team.dreamcar.ua/comments/.
// Дії (POST JSON, Authorization: Bearer <JWT учасника команди>):
//   list                         → останні пули (без rows)
//   get     {id}                 → пул повністю
//   create  {url,title,config}   → новий пул, збір коментарів у фоні (202)
//   refresh {id}                 → перезібрати коментарі у фоні
//   update  {id,title?,config?}  → змінити назву / умови
//   log_draw{id,entry}           → дописати спробу вибору в журнал
//   delete  {id}                 → м'яке видалення (лише ceo/coo або автор)
// Токен Graph API і ig_user_id беруться з app_secrets (fb_access_token, ig_user_id).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GV = "v21.0";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const DEFAULT_EXCLUDED = ["dreamcar.ua", "ai.dreamcar.ua", "club.dreamcar.ua", "some_mario"];

function json(o: unknown, code = 200) {
  return new Response(JSON.stringify(o), { status: code, headers: { ...CORS, "content-type": "application/json" } });
}

function shortcodeOf(url: string): string | null {
  const m = String(url || "").match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return m ? m[1] : null;
}

function cleanConfig(c: any) {
  const arr = (v: any) => (Array.isArray(v) ? v : String(v ?? "").split(/[\n,]+/));
  const strs = (v: any, max = 40) => arr(v).map((s: any) => String(s).trim()).filter(Boolean).slice(0, max);
  const prizes = (Array.isArray(c?.prizes) ? c.prizes : []).slice(0, 6).map((p: any) => ({
    label: String(p?.label ?? "").slice(0, 120),
    method: p?.method === "top_likes" ? "top_likes" : "random",
  })).filter((p: any) => p.label);
  return {
    prizes: prizes.length ? prizes : [{ label: "Приз", method: "random" }],
    rules: strs(c?.rules, 12).map((s: string) => s.slice(0, 200)),
    keywords: strs(c?.keywords, 40).map((s: string) => s.toLowerCase().replace(/^@/, "").slice(0, 60)),
    keywords_required: !!c?.keywords_required,
    include_replies: c?.include_replies !== false,
    one_per_account: !!c?.one_per_account,
    excluded: strs(c?.excluded ?? DEFAULT_EXCLUDED, 50).map((s: string) => s.toLowerCase().replace(/^@/, "")),
    deadline: c?.deadline ? String(c.deadline).slice(0, 40) : null,
    manual: Object.fromEntries(Object.entries(c?.manual && typeof c.manual === "object" ? c.manual : {})
      .filter(([k, v]) => /^\d{5,25}$/.test(k) && (v === "in" || v === "out")).slice(0, 5000)),
  };
}

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const url = path.startsWith("http") ? path : `https://graph.facebook.com/${GV}/${path}${sep}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) throw new Error(`Graph ${r.status}: ${body?.error?.message ?? "unknown"}`);
  return body;
}

async function secrets(sb: any) {
  const { data } = await sb.from("app_secrets").select("key,value").in("key", ["fb_access_token", "ig_user_id"]);
  const m: Record<string, string> = {};
  for (const r of data ?? []) m[r.key] = String(r.value ?? "").replace(/"/g, "");
  return { token: m.fb_access_token ?? "", igUser: m.ig_user_id || "17841403783002317" };
}

async function resolveMedia(sb: any, shortcode: string, token: string, igUser: string): Promise<string> {
  const { data } = await sb.from("dashboard_ig_media").select("media_id").ilike("permalink", `%/${shortcode}/%`).limit(1);
  if (data?.[0]?.media_id) return String(data[0].media_id);
  let next: string | null = `${igUser}/media?fields=id,shortcode,permalink&limit=100`;
  for (let page = 0; next && page < 25; page++) {
    const b: any = await graph(next, token);
    for (const m of b.data ?? []) {
      if (m.shortcode === shortcode || String(m.permalink ?? "").includes(`/${shortcode}/`)) return String(m.id);
    }
    next = b.paging?.next ?? null;
  }
  throw new Error("Пост не знайдено серед публікацій @dreamcar.ua (перевір посилання: пост має бути нашого акаунта)");
}

// row: [id, epoch_ms, username, text, likes, isReply, hidden, parentId]
async function collect(sb: any, id: string) {
  const { data: pool } = await sb.from("comment_pools").select("id,shortcode,media_id").eq("id", id).single();
  if (!pool) return;
  await sb.from("comment_pools").update({ status: "fetching", error: null, updated_at: new Date().toISOString() }).eq("id", id);
  try {
    const { token, igUser } = await secrets(sb);
    if (!token) throw new Error("Немає fb_access_token в app_secrets");
    const mediaId = pool.media_id || await resolveMedia(sb, pool.shortcode, token, igUser);
    const m: any = await graph(`${mediaId}?fields=id,caption,permalink,timestamp,like_count,comments_count,media_type,media_product_type,username`, token);
    const post: any = {
      caption: m.caption ?? "", permalink: m.permalink, timestamp: m.timestamp, media_type: m.media_type,
      product: m.media_product_type, like_count: m.like_count ?? null, comments_count: m.comments_count ?? null,
    };
    try {
      const metrics = m.media_product_type === "REELS" ? "reach,saved,shares,views,total_interactions,comments,likes" : "reach,saved,shares,views,total_interactions,comments,likes";
      const ins: any = await graph(`${mediaId}/insights?metric=${metrics}`, token);
      for (const x of ins.data ?? []) post[`i_${x.name}`] = x.values?.[0]?.value ?? null;
    } catch (e) { post.insights_error = String((e as Error).message).slice(0, 200); }

    const rows: any[] = [];
    const seen = new Set<string>();
    const push = (c: any, parent: string | null) => {
      if (!c?.id || seen.has(c.id)) return;
      seen.add(c.id);
      rows.push([c.id, Date.parse(String(c.timestamp).replace(/\+0000$/, "Z")) || 0, String(c.username ?? c.from?.username ?? ""), String(c.text ?? ""), Number(c.like_count ?? 0), parent ? 1 : 0, c.hidden ? 1 : 0, parent]);
    };
    const rf = "id,text,timestamp,username,like_count,hidden";
    let next: string | null = `${mediaId}/comments?fields=${rf},replies.limit(50){${rf}}&limit=50`;
    let pages = 0;
    while (next && pages < 400) {
      const b: any = await graph(next, token);
      pages++;
      for (const c of b.data ?? []) {
        push(c, null);
        for (const r of c.replies?.data ?? []) push(r, c.id);
        let rn: string | null = c.replies?.paging?.next ?? null;
        let rp = 0;
        while (rn && rp < 40) {
          const rb: any = await graph(rn, token);
          rp++;
          for (const r of rb.data ?? []) push(r, c.id);
          rn = rb.paging?.next ?? null;
        }
      }
      next = b.paging?.next ?? null;
    }
    post.api_pages = pages;
    post.graph_total = rows.length;

    // Graph /{media}/comments інколи віддає 0 при сотнях коментарів (16.11.2026: DfHPBGFMHta, 0 проти 474).
    // Вебхук ig-comments-bot пише кожен коментар у ig_comment_queue: добираємо звідти, лайки тягнемо по id.
    const queued: any[] = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data: q } = await sb.from("ig_comment_queue").select("comment_id,author,comment_text,comment_ts,parent_id,status")
        .eq("media_id", mediaId).order("comment_ts", { ascending: true }).range(from, from + 999);
      if (!q?.length) break;
      queued.push(...q);
      if (q.length < 1000) break;
    }
    post.queue_total = queued.length;
    const missing = queued.filter((q) => !seen.has(String(q.comment_id)) && q.status !== "gone");
    // Коментування вимкнено (comments_count = 0, а /comments порожній): Instagram ховає всі коментарі,
    // і запит по id теж падає «does not exist». Тоді це не видалення: беремо журнал як є, лайки невідомі.
    const commentsOff = rows.length === 0 && Number(m.comments_count ?? 0) === 0 && missing.length > 0;
    post.comments_off = commentsOff;
    if (commentsOff) {
      for (const q of missing) {
        seen.add(String(q.comment_id));
        rows.push([String(q.comment_id), Date.parse(q.comment_ts) || 0, String(q.author ?? ""), String(q.comment_text ?? ""), null, q.parent_id ? 1 : 0, 0, q.parent_id ? String(q.parent_id) : null]);
      }
      post.queue_added = missing.length;
    } else if (missing.length) {
      let gone = 0, likesOk = 0;
      for (let i = 0; i < missing.length; i += 10) {
        await Promise.all(missing.slice(i, i + 10).map(async (q) => {
          let likes: number | null = null, hidden = 0;
          try {
            const c: any = await graph(`${q.comment_id}?fields=id,like_count,hidden`, token);
            likes = Number(c.like_count ?? 0); hidden = c.hidden ? 1 : 0; likesOk++;
          } catch (e) {
            if (/does not exist|cannot be loaded|Unsupported get request|deleted/i.test(String((e as Error).message))) { gone++; return; }
          }
          seen.add(String(q.comment_id));
          rows.push([String(q.comment_id), Date.parse(q.comment_ts) || 0, String(q.author ?? ""), String(q.comment_text ?? ""), likes ?? 0, q.parent_id ? 1 : 0, hidden, q.parent_id ? String(q.parent_id) : null]);
        }));
      }
      post.queue_added = missing.length - gone;
      post.queue_gone = gone;
      post.queue_likes_ok = likesOk;
    }
    rows.sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
    post.api_total = rows.length;
    await sb.from("comment_pools").update({
      media_id: mediaId, post, rows, status: "ready", error: null,
      fetched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", id);
  } catch (e) {
    await sb.from("comment_pools").update({ status: "error", error: String((e as Error).message).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", id);
  }
}

function bg(p: Promise<unknown>) {
  // @ts-ignore EdgeRuntime існує в Supabase Edge
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p); else p.catch(() => {});
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

  // Автентифікація: дійсна сесія + активний запис у public.users
  // Системний виклик (pg_cron / pg_net / агент): x-hq-cron-secret = app_secrets.hq_cron_secret
  let uid: string | null = null;
  let me: any = null;
  const cron = req.headers.get("x-hq-cron-secret") ?? "";
  if (cron.length >= 32) {
    const { data: cs } = await sb.from("app_secrets").select("value").eq("key", "hq_cron_secret").maybeSingle();
    if (cs?.value && String(cs.value) === cron) me = { name: "system", role: "system" };
  }
  if (!me) {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const { data: ud, error: ue } = await sb.auth.getUser(jwt);
    if (ue || !ud?.user) return json({ error: "unauthorized" }, 401);
    uid = ud.user.id;
    const { data: us } = await sb.from("users").select("id,name,role,is_active,auth_id,auth_id_aliases")
      .or(`auth_id.eq.${uid},auth_id_aliases.cs.{${uid}}`).limit(1);
    me = us?.[0];
    if (!me || me.is_active === false) return json({ error: "forbidden: not a team member" }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? "");

  if (action === "list") {
    const { data, error } = await sb.from("comment_pools")
      .select("id,created_at,created_by_name,url,shortcode,title,status,error,fetched_at,config,draws,frozen->>at,post->>timestamp,post->>api_total")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(100);
    if (error) return json({ error: error.message }, 500);
    return json({ items: data, me: { name: me.name, role: me.role } });
  }

  if (action === "create") {
    const sc = shortcodeOf(body.url);
    if (!sc) return json({ error: "Не схоже на посилання на пост Instagram (потрібен формат instagram.com/p/… або /reel/…)" }, 400);
    const cfg = cleanConfig(body.config ?? {});
    const { data, error } = await sb.from("comment_pools").insert({
      url: `https://www.instagram.com/p/${sc}/`, shortcode: sc, title: String(body.title ?? "").slice(0, 160),
      config: cfg, created_by: uid, created_by_name: me.name ?? null,
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    bg(collect(sb, data.id));
    return json({ id: data.id, status: "queued" }, 202);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);
  const { data: pool } = await sb.from("comment_pools").select("id,created_by,draws,status,frozen,skipped").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!pool) return json({ error: "not found" }, 404);

  if (action === "get") {
    const { data } = await sb.from("comment_pools").select("*").eq("id", id).single();
    return json({ pool: data, me: { name: me.name, role: me.role } });
  }
  if (action === "refresh") {
    if (pool.status === "fetching") return json({ status: "fetching" }, 202);
    bg(collect(sb, id));
    return json({ status: "queued" }, 202);
  }
  if (action === "freeze") {
    if (pool.frozen) return json({ error: "Пул уже зафіксовано" }, 409);
    if (pool.status !== "ready") return json({ error: "Дочекайтеся завершення збору коментарів" }, 409);
    const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 100000).map((e: any) => [
      Number(e?.[0]) || 0, String(e?.[1] ?? "").slice(0, 40), String(e?.[2] ?? "").slice(0, 60), String(e?.[3] ?? "").slice(0, 2200), Number(e?.[4]) || 0,
    ]).filter((e: any[]) => e[0] > 0 && /^\d{5,25}$/.test(e[1]));
    if (!entries.length) return json({ error: "Порожній пул: фіксувати нічого" }, 400);
    const ns = entries.map((e: any[]) => e[0]).sort((a: number, b: number) => a - b);
    if (ns.some((n: number, i: number) => n !== i + 1)) return json({ error: "Номери мають іти підряд від 1" }, 400);
    const { data: cur } = await sb.from("comment_pools").select("config").eq("id", id).single();
    const frozen = { at: new Date().toISOString(), by: me.name ?? null, config: cur?.config ?? {}, entries };
    const { error } = await sb.from("comment_pools").update({ frozen, updated_at: new Date().toISOString() }).eq("id", id).is("frozen", null);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, frozen });
  }
  if (action === "unfreeze") {
    if (!["ceo", "coo", "system"].includes(String(me.role))) return json({ error: "Зняти фіксацію може лише CEO або COO" }, 403);
    if ((pool.draws ?? []).some((d: any) => d.status === "picked")) return json({ error: "Уже були спроби вибору: фіксацію не знімаємо" }, 409);
    await sb.from("comment_pools").update({ frozen: null, updated_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true });
  }
  if (action === "update") {
    if (pool.frozen && body.config) return json({ error: "Пул зафіксовано: умови не змінюються" }, 409);
    const patch: any = { updated_at: new Date().toISOString() };
    if (typeof body.title === "string") patch.title = body.title.slice(0, 160);
    if (body.config) patch.config = cleanConfig(body.config);
    const { error } = await sb.from("comment_pools").update(patch).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, config: patch.config });
  }
  if (action === "log_draw") {
    const e = body.entry ?? {};
    const entry = {
      at: new Date().toISOString(), by: me.name ?? null,
      prize: String(e.prize ?? "").slice(0, 120), method: e.method === "top_likes" ? "top_likes" : "random",
      n: Number(e.n) || null, pool_size: Number(e.pool_size) || null, comment_id: String(e.comment_id ?? "").slice(0, 40),
      username: String(e.username ?? "").slice(0, 60), text: String(e.text ?? "").slice(0, 300), status: String(e.status ?? "picked").slice(0, 20),
    };
    const draws = Array.isArray(pool.draws) ? pool.draws : [];
    draws.push(entry);
    const { error } = await sb.from("comment_pools").update({ draws, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, draws });
  }
  if (action === "remove_draw") {
    // Невдала спроба зникає з журналу повністю; skip=true — учасник більше не потрапляє в наступні спроби
    const cid = String(body.comment_id ?? ""), prize = String(body.prize ?? "");
    if (!/^\d{5,25}$/.test(cid)) return json({ error: "bad comment_id" }, 400);
    const before = Array.isArray(pool.draws) ? pool.draws : [];
    const hit = before.find((d: any) => d.comment_id === cid && d.prize === prize && d.status === "picked");
    if (!hit) return json({ error: "Спробу не знайдено" }, 404);
    const draws = before.filter((d: any) => !(d.comment_id === cid && d.prize === prize));
    const skipped = Array.isArray(pool.skipped) ? pool.skipped : [];
    if (body.skip) skipped.push({ comment_id: cid, username: hit.username, prize, at: new Date().toISOString(), by: me.name ?? null });
    const { error } = await sb.from("comment_pools").update({ draws, skipped, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, draws, skipped });
  }
  if (action === "delete") {
    if (!(["ceo", "coo", "system"].includes(String(me.role)) || (uid && pool.created_by === uid))) return json({ error: "forbidden" }, 403);
    await sb.from("comment_pools").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});
