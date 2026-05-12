// =====================================================================
// DreamCar HQ — Стіл SMM
// Конфігурація бекенду
//
// ВАЖЛИВО: цей файл містить лише ПУБЛІЧНІ ключі (anon — це read-only
// до публічних даних, RLS-захищений). Service-role key зберігається
// ТІЛЬКИ в env-змінних Edge Functions, не тут.
//
// Як отримати:
//   1. https://supabase.com → твій проєкт → Settings → API
//   2. Project URL: https://xxxxx.supabase.co
//   3. anon public key (JWT що починається з "eyJh...")
//
// Поки порожньо — застосунок працює в demo-режимі через localStorage.
// =====================================================================

window.HQ_CONFIG = {
  // ---- Supabase ----
  SUPABASE_URL:      '',  // ← https://xxxxx.supabase.co
  SUPABASE_ANON_KEY: '',  // ← eyJh...

  // ---- Telegram Login (опційно) ----
  // Bot username у вигляді "dreamcar_hr_bot" (без @)
  // Для роботи Login Widget bot має бути зареєстрований у @BotFather
  // через /setdomain → dreamcarua.github.io
  TG_LOGIN_BOT: '',

  // ---- TG bot для сповіщень (вже маємо) ----
  TG_BOT_TOKEN:  '8461032235:AAE70f7xmBIrGW7-dC5GfcYvQjjRYUk6IEg',
  TG_GROUP_CHAT: '-5205303628',

  // ---- Поведінка ----
  // Якщо true — навіть при наявному backend дозволяє demo-режим
  // (для розробки/презентації без логіну)
  ALLOW_DEMO_FALLBACK: true,
};
