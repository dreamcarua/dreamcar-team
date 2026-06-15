// disabled one-off (kasa-migrate)
Deno.serve(() => new Response("gone", { status: 410 }));
