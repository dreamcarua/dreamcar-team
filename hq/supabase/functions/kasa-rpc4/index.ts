// disabled one-off (kasa-rpc4) — RPC оновлені (active-only) у БД
Deno.serve(() => new Response("gone", { status: 410 }));
