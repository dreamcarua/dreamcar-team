// disabled one-off (kasa-check)
Deno.serve(() => new Response("gone", { status: 410 }));
