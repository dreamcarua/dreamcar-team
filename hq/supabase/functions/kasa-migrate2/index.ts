// disabled one-off (kasa-migrate2)
Deno.serve(() => new Response("gone", { status: 410 }));
