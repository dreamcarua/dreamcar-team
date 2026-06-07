# Rollback Procedures — DreamCar Production

> Останнє оновлення: 07.06.2026

## When to rollback

- Edge function deploy зламав production (5xx errors >5% rate)
- Frontend deploy має SyntaxError → "Завантаження..." hang
- DB migration призвела до data loss / corruption
- RLS policy блокує critical flow

## Edge function rollback

Supabase Edge Functions автоматично зберігають історію версій.

### Через GH Action (рекомендовано)
1. Знайди останній robocan commit у GitHub: https://github.com/dreamcarua/dreamcar-team/commits/main
2. `git revert <bad-commit-sha>`
3. `git push` → GH Action автоматично деплоїть edge functions з cancelled версією

### Через Supabase Dashboard (швидко)
1. https://supabase.com/dashboard/project/wotghlaehnvxyeacznvv/functions
2. Знайди функцію
3. Натисни "..." → "View Version History"
4. Вибери попередню working версію
5. Click "Deploy this version"

**Час:** ~30 сек для rollback.

## Database migration rollback

⚠️ **Supabase migrations forward-only за замовчуванням.** DDL operations складно rollback.

### Якщо migration ще не у production
1. Supabase Dashboard → Database → Migrations
2. Видалити migration з queue
3. `git revert` migration commit

### Якщо вже застосовано
1. **Restore from PITR** — Supabase Pro має point-in-time recovery 7 днів
2. Dashboard → Settings → Database → Backups → Point in time
3. Вибрати timestamp перед migration
4. Restore

⚠️ Це **destrictive** — втрачаєш ВСЕ після цього timestamp.

### Manual DDL reverse
Для деяких операцій:
- `ADD COLUMN` → `DROP COLUMN`
- `CREATE INDEX` → `DROP INDEX`
- `CREATE FUNCTION` → відновити попередню версію функції з git history

## Frontend rollback

GitHub Pages деплоїть від main branch автоматично.

### Через git revert
1. `git revert <bad-commit-sha>`
2. `git push` → GitHub Pages передеплоюється за 1-2 хв
3. CloudFlare CDN cache може тримати 10 хв — додай `?v=<timestamp>` до URL

### Через previous commit
1. `git reset --hard <good-commit-sha>` (⚠️ deстructive)
2. `git push --force` → але branch protection блокує force push
3. Краще: `git revert` або новий commit

## Cron job rollback

```sql
-- Disable temporarily
UPDATE cron.job SET active = false WHERE jobname = '<JOBNAME>';

-- Restore from migration history
SELECT cron.unschedule('<JOBNAME>');
SELECT cron.schedule('<JOBNAME>', '<old-schedule>', '<old-command>');
```

## Specific incident scenarios

### Bad RLS policy блокує всіх юзерів
1. `pg_admin` через Supabase Dashboard
2. SQL: `ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;` (тимчасово)
3. Виправити policy
4. `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`

### Edge fn callback циклично fails
1. Перевір secrets — можливо ротував `TG_BOT_TOKEN` без update у GH Actions
2. `get_logs` для edge fn → знайди error
3. Disable cron job що його викликає (`UPDATE cron.job SET active=false`)
4. Виправ → reactivate

### TG bot перестав відповідати
1. Check `tg-webhook` health: WebFetch `https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-webhook` GET → має повертати 405/200
2. Check Telegram setWebhook: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
3. Якщо `pending_update_count` > 50 — webhook stuck. Restart через `setWebhook` again.

## Post-rollback checklist

- [ ] Виявити root cause (не лише симптом)
- [ ] Update CHANGELOG.md з ROLLBACK подією
- [ ] Notify Vadym через TG `cowork-notify/` JSON
- [ ] Створити incident document у `INCIDENTS.md`
- [ ] Сплануй fix і re-deploy

## Contacts during incident

- Vadym Gryshyn (CEO) — primary
- Phillip — секундарний
- Артем — для tracker / dashboard issues
