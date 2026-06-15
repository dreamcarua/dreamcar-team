// disabled one-off (kasa-diag)
Deno.serve(() => new Response("gone", { status: 410 }));
