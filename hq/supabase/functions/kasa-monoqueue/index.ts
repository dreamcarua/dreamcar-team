// disabled one-off (kasa-monoqueue) — черга kasa_mono_queue вже створена/засіяна
Deno.serve(() => new Response("gone", { status: 410 }));
