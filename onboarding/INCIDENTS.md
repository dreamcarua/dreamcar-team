# Incidents Log — DreamCar Production

Format: `## YYYY-MM-DD HH:MM — Short Title`

Each entry includes:
- **Detected by:** (хто помітив)
- **Severity:** P0/P1/P2/P3
- **Symptom:** що бачив юзер
- **Root cause:** діагноз
- **Fix:** що зробили
- **Prevention:** як уникнути у майбутньому

---

## 2026-06-06 — Session leak: Олександр бачив CEO інтерфейс

- **Detected by:** Олександр через TG
- **Severity:** P0
- **Symptom:** Hardcoded "Вадим CEO" placeholder показувався 0.5s до завантаження real user
- **Root cause:** `<div id='roleName'>Вадим</div>` у HQ index.html
- **Fix:** Замінено на `'…'` + CSS visibility:hidden до завантаження user
- **Prevention:** ніколи не використовувати hardcoded user/role placeholders у HTML

---

## 2026-06-06 — Git merge markers ламали SMM повністю

- **Detected by:** Audit agent
- **Severity:** P0
- **Symptom:** SyntaxError, HQ не завантажується
- **Root cause:** `<<<<<<< Updated upstream / ======= / >>>>>>>` залишилися у index.html після stash pop
- **Fix:** Видалено markers + 1872 рядки застарілого inline JS
- **Prevention:** HARD RULE — після `git stash pop` обов'язково `grep '^<<<<<<<\|^=======$\|^>>>>>>>'`

---

(додавай нові інциденти зверху)
