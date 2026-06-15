// disabled one-off (kasa-migrate5)
Deno.serve(() => new Response("gone", { status: 410 }));
