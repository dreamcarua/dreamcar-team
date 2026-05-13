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
// =====================================================================

window.HQ_CONFIG = {
  // ---- Supabase ----
  SUPABASE_URL:      'https://wotghlaehnvxyeacznvv.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvdGdobGFlaG52eHllYWN6bnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDc4NjgsImV4cCI6MjA5NDE4Mzg2OH0.Se-y1WawsdSkMLXj7G_O-Kq-jVfjUOBD3KJOvemCR3A',

  // ---- Telegram bot ----
  // Bot username у вигляді "dreamcar_team_bot" (без @)
  // Використовується для:
  //   - кнопки «🔗 Прив'язати через бот» у Settings (deep-link)
  //   - Login Widget (потребує /setdomain dreamcarua.github.io у @BotFather)
  TG_BOT_USERNAME: 'dreamcar_team_bot',
  TG_LOGIN_BOT:    '',  // залиш порожнім поки не зробиш /setdomain

  // ---- TG bot токен (для сповіщень) ----
  TG_BOT_TOKEN:  '8461032235:AAE70f7xmBIrGW7-dC5GfcYvQjjRYUk6IEg',
  TG_GROUP_CHAT: '-5205303628',

  // ---- Поведінка ----
  // Якщо true — навіть при наявному backend дозволяє demo-режим
  // (для розробки/презентації без логіну)
  ALLOW_DEMO_FALLBACK: true,
};
