// disabled one-off (kasa-migrate3)
Deno.serve(() => new Response("gone", { status: 410 }));
