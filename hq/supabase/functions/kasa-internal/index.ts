// disabled one-off (kasa-internal) — тригер kasa_mark_internal вже в БД
Deno.serve(() => new Response("gone", { status: 410 }));
