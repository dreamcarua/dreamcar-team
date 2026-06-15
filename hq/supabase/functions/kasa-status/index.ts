// One-off status reader — виконано і вимкнено.
Deno.serve(() => new Response("gone", { status: 410 }));
