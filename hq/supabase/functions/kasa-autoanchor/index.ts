// disabled one-off (kasa-autoanchor) — функція kasa_try_reanchor + cron вже в БД
Deno.serve(() => new Response("gone", { status: 410 }));
