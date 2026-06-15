// disabled one-off (kasa-migrate4)
Deno.serve(() => new Response("gone", { status: 410 }));
