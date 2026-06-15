// disabled one-off (kasa-owner) — owner_name + динамічний тригер вже в БД
Deno.serve(() => new Response("gone", { status: 410 }));
