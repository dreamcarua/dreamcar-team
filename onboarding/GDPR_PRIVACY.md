# GDPR & Privacy — DreamCar

> Останнє оновлення: 07.06.2026

## What personal data we store

### `public.users` (DreamCar team)
- `email`, `name`, `telegram_username`, `tg_chat_id`, `avatar_url`
- **Purpose:** Authentication, role-based access, internal notifications
- **Legal basis:** Contract (співробітник/CEO)
- **Retention:** Поки активний у команді + 6 місяців після виходу

### `public.dashboard_deals` (DreamCar клієнти)
- `name`, `email`, `phone` (через SendPulse Sync), `amount`, `currency`, `paid_at`
- **Purpose:** Аналітика продажів, RPS, ROI per project
- **Legal basis:** Performance of contract (квиток на платформу DreamCar)
- **Retention:** 5 років (фінансовий audit)

### `public.checkout_events` (Upsell A/B tracker)
- `session_id` (cookie-based, не PII), `user_id` (опційно), `utm_*`, `device`, `referrer`
- **Purpose:** A/B/C тестування воронки upsell
- **Legal basis:** Legitimate interest (improving product)
- **Retention:** 90 днів rolling

### `public.tg_chat_buffer` (Telegram messages for AI task extraction)
- `chat_id`, `user_id` (TG), `text`, `ts`
- **Purpose:** Auto-detect задач з командних TG чатів
- **Legal basis:** Legitimate interest (team productivity)
- **Retention:** 7 днів rolling (`tg-chat-buffer-cleanup-daily` cron)

### `public.publication_history` / `team_task_history`
- `actor_id` (хто зробив дію), `action`, `detail`, `at`
- **Purpose:** Audit trail
- **Retention:** Permanent (soft-delete pub/task залишає history)

## Right to be forgotten — DreamCar клієнти

### Якщо клієнт DreamCar просить видалення своїх даних:

1. **Email/phone identification** — знайди у `dashboard_deals`:
   ```sql
   SELECT id, email, phone, paid_at FROM public.dashboard_deals 
   WHERE email = '<EMAIL>' OR phone = '<PHONE>';
   ```

2. **Pseudonymize (не DELETE — для audit)**:
   ```sql
   UPDATE public.dashboard_deals 
   SET email = 'erased_' || id::text || '@deleted.dreamcar.ua',
       name = 'ERASED',
       phone = NULL,
       meta = jsonb_build_object('erased_at', now())
   WHERE email = '<EMAIL>';
   ```

3. **SendPulse unsubscribe**:
   - Логін у SendPulse Dashboard → Audience → знайди email/phone → Delete
   - (READ-ONLY rule забороняє автоматично — манально через UI)

4. **Logs у `checkout_events`** — session-based, без direct PII → не потребує дій
5. **TG buffer** — авто-cleanup через 7 днів

### Якщо член команди DreamCar просить видалення:

1. **Deactivate user** (зберігає historу):
   ```sql
   UPDATE public.users SET is_active = false WHERE email = '<EMAIL>';
   ```

2. **Через 6 місяців pseudonymize**:
   ```sql
   UPDATE public.users 
   SET email = NULL, name = 'Ex-User', telegram_username = NULL, 
       tg_chat_id = NULL, avatar_url = NULL
   WHERE email = '<EMAIL>' AND is_active = false;
   ```

3. **Foreign keys** на `users.id` залишаються (history audit), але PII зачищена.

## Data export — клієнт хоче забрати свої дані

```sql
SELECT json_agg(t) FROM (
  SELECT id, email, name, phone, amount, currency, paid_at, project, source
  FROM public.dashboard_deals 
  WHERE email = '<EMAIL>'
) t;
```

→ Експортувати JSON, надіслати клієнту у відповідь на запит. Зробити це у термін **30 днів** від запиту (GDPR Article 12).

## Data breach response

Якщо виявлено leak персональних даних:

1. **Stop the bleed** — revoke compromised secret (див. `SECRETS.md`)
2. **Assess scope** — скільки records / який тип PII
3. **Notify authorities** — якщо >100 records чи sensitive PII (medical, financial):
   - Україна: НКРПС (Національна комісія регулювання послуг електронних комунікацій)
   - ЄС: відповідний DPA країни (якщо є EU клієнти)
   - **Термін:** 72 години від виявлення
4. **Notify affected users** — якщо ризик high (financial/identity theft)
5. **Document** інцидент у `INCIDENTS.md`

## Third-party processors

| Service | Data | Purpose | DPA |
|---|---|---|---|
| Supabase | All | Database hosting | https://supabase.com/legal/dpa |
| Telegram | TG user IDs, usernames | Bot communication | https://telegram.org/privacy |
| SendPulse | Email, phone | Customer communication | https://sendpulse.com/dpa |
| Meta (Facebook) | Ad campaign data | Marketing analytics | https://www.facebook.com/legal/terms/dataprocessing |
| Cloudflare R2 | Видео креативів (no PII) | Static asset CDN | https://www.cloudflare.com/cloudflare-customer-dpa/ |
| Anthropic | TG message snippets (AI task extraction) | Claude Haiku | https://www.anthropic.com/legal/dpa |
| OpenAI | Voice messages (Whisper STT) | Speech-to-text | https://openai.com/policies/data-processing-addendum/ |

## Data minimization principles

- **NEVER log full PII** у `console.log` / edge fn logs
- **Hash** session_id з salt, не plain `user_id` де можливо
- **Auto-purge** старі логи через cron (вже працює: `*-cleanup-daily`)
- **Soft-delete by default** — hard DELETE тільки через trash purge після 30 днів

## See also

- `SECRETS.md` — токени і ключі
- `INCIDENTS.md` — журнал breach'ів
- Memory rule [feedback-sendpulse-readonly] — SendPulse тільки READ
