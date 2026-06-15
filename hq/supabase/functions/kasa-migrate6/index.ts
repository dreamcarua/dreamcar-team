// disabled one-off (kasa-migrate6)
Deno.serve(() => new Response("gone", { status: 410 }));
