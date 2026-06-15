// disabled one-off (kasa-rpc) — RPC kasa_monthly_cashflow/kasa_account_ops вже в БД
Deno.serve(() => new Response("gone", { status: 410 }));
