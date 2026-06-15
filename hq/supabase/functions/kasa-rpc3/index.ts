// disabled one-off (kasa-rpc3) — RPC kasa_cashflow(from,to,gran) вже в БД
Deno.serve(() => new Response("gone", { status: 410 }));
