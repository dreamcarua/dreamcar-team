# reports/

Один JSON-файл — один звіт. Коміт у `main` → `.github/workflows/report-to-telegram.yml` шле його в Telegram через `@dreamcar_team_bot`. Старі звіти не редагуємо: це журнал доставки.

Імʼя файлу: `YYYY-MM-DD-HHMM-<slug>.json` (CET/CEST). Вміст — тільки простий текст, без markdown і без `<` `>`:

```json
{
  "project": "DreamCar Team Hub",
  "date": "03.09.2026 22:15",
  "summary": "Два-три речення: що зроблено і що це змінює для власника. Не перелік кроків.",
  "breaks_if_not_done": "Один рядок: що зламалося б або лишилося б зламаним.",
  "open_tasks": 18,
  "on_us": 6,
  "waiting_for": "Вадим — мерж гілки memory-v8",
  "link": "https://…  (превʼю, скріншот, PR) — необовʼязково"
}
```

Слати, коли задача змінила стан проєкту. Не слати на питання, читання, оцінки.

Перевірка доставки: `gh run list --workflow=report-to-telegram.yml --limit 1 -R dreamcarua/dreamcar-team` → `success`.

Секрети: `TG_BOT_TOKEN`, `TG_CHAT_ID` (обидва вже є в репо). Значень тут немає — репозиторій публічний.
Не плутати з `cowork-notify/` — то вільний канал коротких нотифікацій; тут структурований звіт про виконану задачу.
