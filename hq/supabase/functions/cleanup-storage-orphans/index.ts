// =====================================================================
// Supabase Edge Function: cleanup-storage-orphans
// =====================================================================
// Видаляє orphan-файли з bucket 'creatives' — ті що НЕ мають references
// у public.creatives (drive_file_id / thumbnail_url / compressed_url).
//
// SQL DELETE заборонено storage.protect_delete() — використовуємо Storage API.
//
// POST /functions/v1/cleanup-storage-orphans
// Body: { dry_run?: boolean, max_delete?: number, only_older_than_hours?: number }
// Auth: Authorization: Bearer <hq-cron-secret> або service role JWT
// =====================================================================

// deno-lint-ignore-file no-explicit-any
const HQ_CRON_SECRET = "5a4b2557c83feaea9ca716f0e99db2efe38410474bc086b956d50f50bb3573d5";

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

interface OrphanFile {
  name: string;
  size: number;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonResp({ error: "POST only" }, 405);

  // Auth
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token !== HQ_CRON_SECRET && token !== serviceKey) {
    return jsonResp({ error: "unauthorized" }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const dryRun = body.dry_run !== false; // default true
  const maxDelete = Math.min(Number(body.max_delete) || 50, 200);
  const olderHours = Number(body.only_older_than_hours) || 24;

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const storageBase = `${supaUrl}/storage/v1`;
  const restBase = `${supaUrl}/rest/v1`;

  // 1. Витягую список всіх файлів у bucket
  // Storage list endpoint
  const listResp = await fetch(`${storageBase}/object/list/creatives`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit: 1000, offset: 0, sortBy: { column: "created_at", order: "asc" } }),
  });
  if (!listResp.ok) {
    return jsonResp({ error: "list failed", status: listResp.status, detail: (await listResp.text()).slice(0, 300) }, 500);
  }
  const allObjects: any[] = await listResp.json();

  // 2. Витягую всі references з public.creatives
  const refsResp = await fetch(`${restBase}/creatives?select=drive_file_id,thumbnail_url,compressed_url`, {
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
    },
  });
  if (!refsResp.ok) {
    return jsonResp({ error: "fetch refs failed" }, 500);
  }
  const refs: any[] = await refsResp.json();
  const referencedNames = new Set<string>();
  for (const r of refs) {
    if (r.drive_file_id) referencedNames.add(r.drive_file_id);
    // Витягую filename з URL-ів типу /public/creatives/{filename}
    for (const url of [r.thumbnail_url, r.compressed_url]) {
      if (!url) continue;
      const m = url.match(/\/creatives\/([^?]+)/);
      if (m) referencedNames.add(decodeURIComponent(m[1]));
    }
  }

  // 3. Знаходжу orphans (не referenced + старші за olderHours)
  const cutoff = new Date(Date.now() - olderHours * 3600 * 1000);
  const orphans: OrphanFile[] = allObjects
    .filter((obj: any) => {
      if (referencedNames.has(obj.name)) return false;
      const created = new Date(obj.created_at);
      return created < cutoff;
    })
    .map((obj: any) => ({
      name: obj.name,
      size: obj.metadata?.size || 0,
      created_at: obj.created_at,
    }))
    .slice(0, maxDelete);

  const totalSize = orphans.reduce((sum, f) => sum + f.size, 0);

  if (dryRun) {
    return jsonResp({
      mode: "dry_run",
      total_objects: allObjects.length,
      referenced: referencedNames.size,
      found_orphans: orphans.length,
      total_size_mb: (totalSize / 1024 / 1024).toFixed(2),
      sample_files: orphans.slice(0, 20),
    });
  }

  // 4. Видаляю файли через Storage API (remove)
  const deleted: string[] = [];
  const failed: { name: string; err: string }[] = [];

  // Batch delete — API приймає масив назв
  if (orphans.length > 0) {
    const deleteResp = await fetch(`${storageBase}/object/creatives`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: orphans.map(o => o.name) }),
    });
    if (deleteResp.ok) {
      orphans.forEach(o => deleted.push(o.name));
    } else {
      // Fallback: видаляти по одному
      for (const o of orphans) {
        try {
          const r = await fetch(`${storageBase}/object/creatives/${encodeURIComponent(o.name)}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${serviceKey}` },
          });
          if (r.ok) deleted.push(o.name);
          else failed.push({ name: o.name, err: `${r.status}: ${(await r.text()).slice(0, 100)}` });
        } catch (e: any) {
          failed.push({ name: o.name, err: e.message });
        }
      }
    }
  }

  return jsonResp({
    mode: "delete",
    total_objects: allObjects.length,
    referenced: referencedNames.size,
    found_orphans: orphans.length,
    deleted: deleted.length,
    failed: failed.length,
    freed_mb: (totalSize / 1024 / 1024).toFixed(2),
    sample_deleted: deleted.slice(0, 10),
    sample_failed: failed.slice(0, 5),
  });
});
