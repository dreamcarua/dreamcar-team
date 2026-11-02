// Supabase Edge Function: cd-publish (DreamCar HQ)
// Puts an approved creative-director final into the HQ media library and returns its public URL,
// which Meta accepts as image_url (ads_create_creative). Built 12.10.2026 for unattended ad-director runs.
// 02.11.2026: source moved into this repo (was deployed only from a chat, v25) + video finals (swap-director reels).
// POST /functions/v1/cd-publish?name=..&format=post|stories|reels|carousel&ad_event_id=..&tags=a,b&w=..&h=..&duration=..
// Header: x-cd-secret: <token>; sha256(token) must equal app_secrets.cd_publish_secret_sha256.
// Body: the file bytes: image/png | image/jpeg | image/webp (<= 30 MB) or video/mp4 | video/quicktime (<= 120 MB).
// Returns: { id, url, ad_event_id, launch_id }
// deno-lint-ignore-file no-explicit-any
const DESK = "11111111-1111-1111-1111-111111111111"; // Стіл SMM
const UPLOADER = "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // owner
const MAX_IMAGE = 30 * 1024 * 1024;
const MAX_VIDEO = 120 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov",
};
const FORMATS = ["post", "stories", "reels", "carousel"];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const h = { apikey: key, Authorization: `Bearer ${key}` };

    const token = req.headers.get("x-cd-secret") || "";
    if (token.length < 32) return json(401, { error: "unauthorized" });
    const sr = await fetch(`${url}/rest/v1/app_secrets?select=value&key=eq.cd_publish_secret_sha256`, { headers: h });
    const want = sr.ok ? String((await sr.json())?.[0]?.value || "") : "";
    if (!want || !safeEq(await sha256Hex(token), want)) return json(401, { error: "unauthorized" });

    const q = new URL(req.url).searchParams;
    const mime = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = EXT[mime];
    if (!ext) return json(400, { error: `content-type must be one of ${Object.keys(EXT)}` });
    const isVideo = mime.startsWith("video/");
    const max = isVideo ? MAX_VIDEO : MAX_IMAGE;
    const name = (q.get("name") || `cd_final.${ext}`).slice(0, 200);
    const format = q.get("format");
    if (format && !FORMATS.includes(format)) return json(400, { error: `format must be one of ${FORMATS}` });
    const ev = q.get("ad_event_id");
    if (ev && !/^\d+$/.test(ev)) return json(400, { error: "ad_event_id must be numeric" });
    const tags = ["creative-director", ...(q.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean)].slice(0, 20);
    const w = Number(q.get("w") || 0) || null, hh = Number(q.get("h") || 0) || null;
    const dur = Math.round(Number(q.get("duration") || 0)) || null;

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0 || bytes.length > max) return json(400, { error: `size must be 1..${max} bytes` });

    let launch: string | null = null;
    if (ev) {
      const er = await fetch(`${url}/rest/v1/ad_events?select=id,launch_id&id=eq.${ev}`, { headers: h });
      const rows = er.ok ? await er.json() : [];
      if (!rows.length) return json(400, { error: `ad_event ${ev} not found` });
      launch = rows[0].launch_id ?? null;
    }

    const obj = `cd/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const up = await fetch(`${url}/storage/v1/object/creatives/${obj}`, {
      method: "POST", headers: { ...h, "content-type": mime, "x-upsert": "false" }, body: bytes,
    });
    if (!up.ok) return json(502, { error: "storage upload failed", detail: (await up.text()).slice(0, 200) });
    const pub = `${url}/storage/v1/object/public/creatives/${obj}`;

    // video: already a delivery encode from the pipeline, so marked ready (compress-creative skips it)
    const row: any = {
      desk_id: DESK, uploaded_by: UPLOADER, name, type: isVideo ? "video" : "photo", drive_file_id: obj, size_bytes: bytes.length,
      duration_sec: isVideo ? dur : null,
      width_px: w, height_px: hh, thumbnail_url: isVideo ? null : pub, compressed_url: pub, compressed_status: "ready",
      tags, format: format || null, ad_event_id: ev ? Number(ev) : null, launch_id: launch,
      folder_source: "creative_director",
    };
    const ins = await fetch(`${url}/rest/v1/creatives`, {
      method: "POST", headers: { ...h, "content-type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!ins.ok) return json(502, { error: "library insert failed", detail: (await ins.text()).slice(0, 300), url: pub });
    const out = (await ins.json())[0];
    return json(200, { id: out.id, url: pub, ad_event_id: out.ad_event_id, launch_id: out.launch_id });
  } catch (e: any) {
    console.error("[cd-publish]", e?.message || e);
    return json(500, { error: "internal" });
  }
});
