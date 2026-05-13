# Drive Setup — для upload файлів >50 MB

5 кроків, ~7 хвилин. Після цього файли >50 MB будуть автоматично йти через Google Drive (з прогрес-баром).

---

## 1. Створити Service Account у Google Cloud

1. Відкрий https://console.cloud.google.com/
2. Створи новий проєкт (або обери існуючий) — наприклад «DreamCar HQ»
3. Меню зліва → **APIs & Services → Library** → знайди **«Google Drive API»** → **Enable**
4. Меню зліва → **APIs & Services → Credentials** → **Create Credentials → Service Account**
5. Заповни:
   - Service account name: `dreamcar-hq-drive`
   - Service account ID: автогенерується (напр. `dreamcar-hq-drive@my-project.iam.gserviceaccount.com`)
6. Skip optional permissions → Done
7. У списку Service Accounts → клік на свій → вкладка **Keys** → **Add Key → Create new key → JSON** → завантажиться JSON файл

⚠️ Збережи цей JSON. Він секретний.

---

## 2. Створити папку у Drive і поділитись з SA

1. Відкрий https://drive.google.com
2. Створи нову папку, наприклад **«DreamCar HQ Creatives»**
3. Правий клік → **Share** → встав email Service Account (з JSON, поле `client_email` — напр. `dreamcar-hq-drive@my-project.iam.gserviceaccount.com`)
4. Дай йому роль **Editor**
5. Send (можна без email).
6. Відкрий папку. URL виглядає як `https://drive.google.com/drive/folders/<FOLDER_ID>` — скопіюй `<FOLDER_ID>`

---

## 3. Додати secrets у Supabase

Project Settings → **Edge Functions → Manage secrets → Add new secret**:

| Name | Value |
|---|---|
| `GDRIVE_SA_JSON` | весь зміст JSON-файлу одним рядком |
| `GDRIVE_FOLDER_ID` | id папки з кроку 2 |

Для `GDRIVE_SA_JSON`:
- Відкрий JSON у текстовому редакторі
- Скопіюй усе вміст файла (з фігурними дужками)
- Встав у поле Value як є — Supabase прийме як рядок

---

## 4. Deploy Edge Functions

Через Dashboard (як `daily-digest`):

**Edge Functions → Create a new function** (двічі — по одній на функцію):

| Name | Verify JWT | Source |
|---|---|---|
| `drive-init-upload` | ❌ off | https://github.com/dreamcarua/dreamcar-team/blob/main/hq/supabase/functions/drive-init-upload/index.ts (Raw) |
| `drive-finalize-upload` | ❌ off | https://github.com/dreamcarua/dreamcar-team/blob/main/hq/supabase/functions/drive-finalize-upload/index.ts (Raw) |

Для кожної: Create → встав код → Deploy.

---

## 5. Тест

1. У HQ створи нову публікацію
2. Drag-drop файл >50 MB у блок «Креативи»
3. Toast «Завантажую…» з прогрес-баром
4. Через 10–60 сек (залежно від розміру/інтернету): «✓ Drive · 120 MB»
5. У бібліотеці креативів зʼявиться нова плитка
6. Креатив посилається на Drive URL — відкривається у будь-кого з посиланням

---

## CORS — якщо upload впав

Google Drive API resumable upload потребує preflight з нашого домену. Якщо у DevTools побачиш CORS error при PUT-chunk:

Це означає що нам треба передавати інші headers або проксити через ще одну функцію. Зараз код використовує raw fetch напряму на `googleapis.com/upload/...` — це має працювати без CORS issues бо Google встановлює `Access-Control-Allow-Origin: *` на upload endpoints.

Якщо буде проблема — пришли DevTools Network skrин з помилкою PUT.

---

## Безпека

- `GDRIVE_SA_JSON` — секрет, ніколи не у frontend
- Service Account має доступ ТІЛЬКИ до однієї папки (через крок 2.3 — Share)
- Файли стають public (anyone with link reader), щоб працювало прев'ю
- Це нормально для SMM-креативів (вони і так будуть публічними)
- Якщо потрібен private access — заміни у `drive-finalize-upload` блок з `permissions.create role=reader` на `role=writer` + signed URL

---

## Економіка

- Service Account Drive має 15 GB **на проєкт** (не на акаунт). Можна збільшити до Workspace tariff.
- API quota: 1000 requests/100s — більш ніж достатньо для команди 5–10 людей.
- Bandwidth — безкоштовний (Google не тарифікує).

---

## Якщо щось не працює

```bash
# Швидкий тест init-upload (треба JWT юзера із HQ)
curl -X POST 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/drive-init-upload' \
  -H 'Authorization: Bearer <USER_JWT>' \
  -H 'apikey: <ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"test.txt","mime":"text/plain","size":100}'

# Має повернути {"uploadUrl":"https://...","maxChunkSize":8388608,...}
```

Або глянь логи: Edge Functions → drive-init-upload → Logs.
