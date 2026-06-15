// disabled one-off (kasa-status)
Deno.serve(() => new Response("gone", { status: 410 }));
