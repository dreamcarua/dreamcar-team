// NEUTRALIZED one-off (діагностика реконсиляції). Не використовувати.
Deno.serve(() => new Response("gone", { status: 410 }));
