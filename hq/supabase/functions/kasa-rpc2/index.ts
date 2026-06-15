// disabled one-off (kasa-rpc2) — RPC kasa_account_cashflow вже в БД
Deno.serve(() => new Response("gone", { status: 410 }));
