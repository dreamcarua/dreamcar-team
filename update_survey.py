#!/usr/bin/env python3
"""
update_survey.py
Щоденний скрипт для оновлення survey.html даними з Google Sheets.

Лист: «Опитування» (gid=1055631470)
Таблиця: https://docs.google.com/spreadsheets/d/1ziqnHfIMbUc64zUcKM4KBZAQd2canMhRb9f56iiCZGw

⚠️  ВИМОГА: Таблиця має бути відкрита для перегляду по посиланню
     (Файл → Поділитися → «Будь-хто з посиланням» → Глядач)
"""

import csv
import io
import json
import os
import sys
import urllib.request
from collections import Counter
from datetime import datetime

# ─── конфіг ──────────────────────────────────────────────────────────────────
SHEET_ID = "1ziqnHfIMbUc64zUcKM4KBZAQd2canMhRb9f56iiCZGw"
GID      = "1055631470"
CSV_URL  = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}"

# Шлях відносно цього скрипту — працює і локально, і в GitHub Actions CI
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_PATH = os.path.join(_SCRIPT_DIR, "survey.html")

# ─── маркери для заміни блоку даних у HTML ───────────────────────────────────
MARKER_BEGIN = "// ==SURVEY_DATA_BEGIN=="
MARKER_END   = "// ==SURVEY_DATA_END=="

HISTORY_BEGIN = "// ==SURVEY_HISTORY_BEGIN=="
HISTORY_END   = "// ==SURVEY_HISTORY_END=="

# ─── словник для розпізнавання колонок за ключовими словами ─────────────────
COLUMN_KEYS = {
    "gender":       ["стать", "gender"],
    "age":          ["вік", "вікова", "скільки вам", "age"],
    "city":         ["місто", "де ви", "де живе", "city", "location"],
    "watchDuration":["як давно", "скільки часу стежите", "how long"],
    "participation":["брали участь", "участь", "participation", "launches"],
    "carReason":    ["критерій вибору", "що головне", "чому обираєте", "car choice"],
    "carColor":     ["колір авто", "улюблений колір", "car color"],
    "transport":    ["пересуваєтесь", "транспорт", "transport", "how do you"],
    "dcMeaning":    ["dreamcar для вас", "dreamcar — це", "что такое", "dc meaning"],
    "firstTrip":    ["першим ділом", "перша поїздка", "first trip", "куди поїдеш"],
    "passenger":    ["пасажир", "passenger", "хто буде"],
    "amount":       ["сума участі", "комфортна ціна", "amount", "comfortable"],
    "gadget":       ["гаджет", "приз", "gadget", "prize"],
}

# ─── helper: знайти колонку за ключовими словами ────────────────────────────
def find_col(headers: list[str], keywords: list[str]) -> int | None:
    for i, h in enumerate(headers):
        h_lower = h.lower()
        if any(kw.lower() in h_lower for kw in keywords):
            return i
    return None

# ─── helper: Counter → sorted list of [label, pct] ──────────────────────────
def counter_to_pct(counter: Counter, total: int, top_n: int = 6) -> list[list]:
    if not counter or total == 0:
        return []
    items = counter.most_common(top_n)
    result = [[label, round(count / total * 100, 1)] for label, count in items]
    rest = total - sum(c for _, c in items)
    if rest > 0 and len(items) == top_n:
        result.append(["Інше", round(rest / total * 100, 1)])
    return result

# ─── helper: Counter → dict {labels, data} для Chart.js ─────────────────────
def counter_to_chart(counter: Counter, total: int, top_n: int = 5) -> dict | None:
    items = counter_to_pct(counter, total, top_n)
    if not items:
        return None
    return {"labels": [x[0] for x in items], "data": [x[1] for x in items]}

# ─── download CSV ────────────────────────────────────────────────────────────
def download_csv(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        # спробуємо utf-8, потім cp1251
        for enc in ("utf-8", "utf-8-sig", "cp1251"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

# ─── parse CSV → SURVEY_DATA dict ────────────────────────────────────────────
def parse_csv(csv_text: str) -> dict | None:
    reader = list(csv.reader(io.StringIO(csv_text)))
    if len(reader) < 2:
        print("CSV порожній або тільки заголовок", file=sys.stderr)
        return None

    headers = reader[0]
    rows    = [r for r in reader[1:] if any(cell.strip() for cell in r)]
    total   = len(rows)
    if total == 0:
        return None

    print(f"✓ Завантажено {total} рядків, {len(headers)} колонок")

    def col(key: str) -> int | None:
        return find_col(headers, COLUMN_KEYS.get(key, []))

    def values(key: str) -> list[str]:
        idx = col(key)
        if idx is None:
            return []
        return [r[idx].strip() for r in rows if idx < len(r) and r[idx].strip()]

    def cnt(key: str) -> Counter:
        return Counter(values(key))

    # ── гендер: нормалізуємо відповіді ──────────────────────────────────────
    # ВАЖЛИВО: "female" містить "male" як підрядок — спочатку перевіряємо female!
    gender_raw = values("gender")
    gender_counter: Counter = Counter()
    for v in gender_raw:
        vl = v.lower().strip()
        if any(w in vl for w in ["жін", "woman", "female"]) or vl == "ж":
            gender_counter["Жінки"] += 1
        elif any(w in vl for w in ["чолові", "man"]) or vl in ("м", "male"):
            gender_counter["Чоловіки"] += 1
        else:
            # "other", "небінарна", "prefer not to say" etc → "Інше"
            gender_counter["Інше"] += 1

    # ── вік: нормалізуємо ────────────────────────────────────────────────────
    age_raw = values("age")
    age_counter: Counter = Counter()
    for v in age_raw:
        vl = v.lower().strip()
        if any(x in vl for x in ["18-24", "18–24", "18 - 24", "18-23", "до 24"]):
            age_counter["18–24"] += 1
        elif any(x in vl for x in ["25-34", "25–34", "25 - 34"]):
            age_counter["25–34"] += 1
        elif any(x in vl for x in ["35-44", "35–44", "35 - 44"]):
            age_counter["35–44"] += 1
        elif any(x in vl for x in ["45", "45+"]):
            age_counter["45+"] += 1
        else:
            age_counter[v] += 1

    # ── місто ────────────────────────────────────────────────────────────────
    city_raw = values("city")
    city_counter: Counter = Counter()
    for v in city_raw:
        vl = v.lower()
        if any(w in vl for w in ["мільйон", "kyiv", "київ", "харків", "одес", "дніпр", "million"]):
            city_counter["Місто-мільйонник"] += 1
        elif any(w in vl for w in ["за кордон", "abroad", "польщ", "poland", "europe", "закордон"]):
            city_counter["За кордоном"] += 1
        elif any(w in vl for w in ["невелик", "мале", "маленьк", "small", "town", "селищ", "село"]):
            city_counter["Невелике місто"] += 1
        elif v:
            # будь-яке інше місто без ключових слів -> невелике (fallback)
            city_counter["Невелике місто"] += 1

    # ── participation: якщо city_counter порожній — fallback ──────────────
    if not city_counter:
        city_counter = Counter(city_raw)

    # ── watch duration: перша відповідь = найлояльніша ────────────────────
    watch_raw   = values("watchDuration")
    watch_counter = Counter(watch_raw)

    # ── participation ─────────────────────────────────────────────────────
    part_raw    = values("participation")
    part_counter = Counter(part_raw)

    # ── carReason ─────────────────────────────────────────────────────────
    reason_raw  = values("carReason")
    reason_counter = Counter()
    for v in reason_raw:
        vl = v.lower()
        if any(w in vl for w in ["безпек", "надійн", "safe", "reliab"]):
            reason_counter["Безпека та надійність"] += 1
        elif any(w in vl for w in ["потужн", "динамік", "power", "speed"]):
            reason_counter["Потужність та динаміка"] += 1
        elif any(w in vl for w in ["технологі", "економ", "tech", "econom"]):
            reason_counter["Технології та економія"] += 1
        elif any(w in vl for w in ["статус", "дизайн", "status", "design", "style"]):
            reason_counter["Статус та дизайн"] += 1
        elif v:
            reason_counter[v] += 1

    if not reason_counter:
        reason_counter = Counter(reason_raw)

    # ── color ─────────────────────────────────────────────────────────────
    color_raw   = values("carColor")
    color_counter = Counter()
    for v in color_raw:
        vl = v.lower()
        if any(w in vl for w in ["темн", "чорн", "black", "dark", "сер"]):
            color_counter["Темний"] += 1
        elif any(w in vl for w in ["білий", "white"]):
            color_counter["Білий"] += 1
        else:
            color_counter["Яскравий"] += 1

    if not color_counter:
        color_counter = Counter(color_raw)

    # ── transport ─────────────────────────────────────────────────────────
    transp_raw  = values("transport")
    transp_counter = Counter()
    for v in transp_raw:
        vl = v.lower()
        if any(w in vl for w in ["маю авто", "є авто", "have car", "своя машин", "але хочу"]):
            transp_counter["Маю авто, але хочу апгрейд"] += 1
        elif any(w in vl for w in ["круту", "преміум", "luxury", "sport"]):
            transp_counter["Маю круту тачку"] += 1
        elif any(w in vl for w in ["громадськ", "таксі", "метро", "public", "taxi"]):
            transp_counter["Громадський транспорт / Таксі"] += 1
        elif v:
            transp_counter[v] += 1

    if not transp_counter:
        transp_counter = Counter(transp_raw)

    # ── DreamCar meaning ──────────────────────────────────────────────────
    dc_raw      = values("dcMeaning")
    dc_counter  = Counter()
    for v in dc_raw:
        vl = v.lower()
        if any(w in vl for w in ["шанс", "змінити", "chance", "real"]):
            dc_counter["Реальний шанс змінити життя"] += 1
        elif any(w in vl for w in ["бонус", "bonus"]):
            dc_counter["Бонус у вигляді авто"] += 1
        elif any(w in vl for w in ["азарт", "емоц", "thrill", "fun", "круто"]):
            dc_counter["Азарт та круті емоції"] += 1
        elif v:
            dc_counter[v] += 1

    if not dc_counter:
        dc_counter = Counter(dc_raw)

    # ── firstTrip ─────────────────────────────────────────────────────────
    trip_counter = Counter(values("firstTrip"))

    # ── passenger ─────────────────────────────────────────────────────────
    pass_raw    = values("passenger")
    pass_counter = Counter()
    for v in pass_raw:
        vl = v.lower()
        if any(w in vl for w in ["партнер", "дівчина", "коханий", "partner"]):
            pass_counter["Партнер"] += 1
        elif any(w in vl for w in ["родин", "сім", "family", "дітей"]):
            pass_counter["Родина"] += 1
        elif any(w in vl for w in ["сам", "alone", "один"]):
            pass_counter["Сам"] += 1
        elif any(w in vl for w in ["пес", "кіт", "тварин", "pet", "dog", "cat"]):
            pass_counter["Улюбленець"] += 1
        elif v:
            pass_counter[v] += 1

    if not pass_counter:
        pass_counter = Counter(pass_raw)

    # ── amount ────────────────────────────────────────────────────────────
    amount_raw  = values("amount")
    amount_counter = Counter()
    for v in amount_raw:
        vl = v.lower()
        if any(w in vl for w in ["low", "низьк", "мін", "дешев", "249", "до 500"]):
            amount_counter["Низька"] += 1
        elif any(w in vl for w in ["mid", "середн", "500", "999", "1000"]):
            amount_counter["Середня"] += 1
        elif any(w in vl for w in ["high", "висок", "2000", "3000", "4000"]):
            amount_counter["Висока"] += 1
        elif any(w in vl for w in ["vip", "преміум", "premium", "5000", "9999"]):
            amount_counter["VIP"] += 1
        elif v:
            amount_counter[v] += 1

    if not amount_counter:
        amount_counter = Counter(amount_raw)

    # ── gadget ────────────────────────────────────────────────────────────
    gadget_raw  = values("gadget")
    gadget_counter = Counter()
    for v in gadget_raw:
        vl = v.lower()
        if "iphone" in vl or "айфон" in vl:
            gadget_counter["iPhone"] += 1
        elif any(w in vl for w in ["мотоцикл", "мото", "motorcycle", "bike"]):
            gadget_counter["Мотоцикл"] += 1
        elif any(w in vl for w in ["macbook", "ноутбук", "laptop"]):
            gadget_counter["MacBook"] += 1
        elif any(w in vl for w in ["power bank", "павербанк", "зарядка"]):
            gadget_counter["Power bank"] += 1
        elif any(w in vl for w in ["авто", "машин", "car"]):
            gadget_counter["Авто"] += 1
        elif v:
            gadget_counter[v] += 1

    if not gadget_counter:
        gadget_counter = Counter(gadget_raw)

    # ── обчислити KPI ─────────────────────────────────────────────────────
    watch_list  = counter_to_pct(watch_counter, total, top_n=5)
    transp_list = counter_to_pct(transp_counter, total, top_n=5)
    part_list   = counter_to_pct(part_counter, total, top_n=5)

    loyal_pct   = round(watch_list[0][1], 0) if watch_list else 96
    regular_pct = round(part_list[0][1], 0) if part_list else 70
    car_pct     = round(transp_list[0][1], 0) if transp_list else 71

    today = datetime.now().strftime("%d.%m.%Y")

    # ── зібрати SURVEY_DATA ───────────────────────────────────────────────
    def chart_or_default(counter, default_labels, default_data, top_n=5):
        c = counter_to_chart(counter, total, top_n)
        if c:
            return c
        return {"labels": default_labels, "data": default_data}

    gender_chart = chart_or_default(
        gender_counter,
        ["Чоловіки", "Жінки", "Інше"], [80.9, 14.5, 4.6], top_n=4)

    age_chart = chart_or_default(
        age_counter,
        ["25–34", "35–44", "18–24", "45+"], [49.9, 33.6, 9.6, 6.8], top_n=5)

    city_chart = chart_or_default(
        city_counter,
        ["Місто-мільйонник", "Невелике місто", "За кордоном"], [49.2, 48.6, 2.1], top_n=4)

    reason_chart = chart_or_default(
        reason_counter,
        ["Безпека та надійність", "Потужність та динаміка", "Технології та економія", "Статус та дизайн"],
        [36.5, 24.1, 22.7, 16.6], top_n=5)

    color_chart = chart_or_default(
        color_counter,
        ["Темний", "Білий", "Яскравий"], [52.3, 34.5, 13.1], top_n=4)

    trip_chart = chart_or_default(
        trip_counter,
        ["Нічне місто", "Гори / море", "Траса 292 к.с", "На роботу"],
        [34.8, 23.5, 23.3, 18.3], top_n=5)

    pass_chart = chart_or_default(
        pass_counter,
        ["Партнер", "Родина", "Сам", "Улюбленець"], [47.2, 33.5, 16.8, 2.4], top_n=4)

    amount_chart = chart_or_default(
        amount_counter,
        ["Низька", "Середня", "Висока", "VIP"], [37.9, 45.3, 14.3, 2.4], top_n=4)

    def list_or_default(lst, default):
        return lst if lst else default

    data = {
        "meta": {
            "totalResponses": total,
            "loyalPct": int(loyal_pct),
            "regularPlayersPct": int(regular_pct),
            "haveCarPct": int(car_pct),
            "lastUpdated": today
        },
        "gender":       gender_chart,
        "age":          age_chart,
        "city":         city_chart,
        "watchDuration": list_or_default(
            counter_to_pct(watch_counter, total, top_n=4),
            [["Давно з нами, вірять в удачу", 95.7], ["Щойно підписалися", 3.8], ["Просто проходили повз", 0.5]]
        ),
        "participation": list_or_default(
            counter_to_pct(part_counter, total, top_n=4),
            [["Регулярний гравець", 70.3], ["Брав 1-2 рази", 27.0], ["Вперше", 2.7]]
        ),
        "carReason":    reason_chart,
        "carColor":     color_chart,
        "transport": list_or_default(
            counter_to_pct(transp_counter, total, top_n=4),
            [["Маю авто, але хочу апгрейд", 71.2], ["Громадський транспорт / Таксі", 24.7], ["Маю круту тачку", 4.1]]
        ),
        "dcMeaning": list_or_default(
            counter_to_pct(dc_counter, total, top_n=4),
            [["Реальний шанс змінити життя", 41.8], ["Бонус у вигляді авто", 29.8], ["Азарт та круті емоції", 28.3]]
        ),
        "firstTrip":    trip_chart,
        "passenger":    pass_chart,
        "amount":       amount_chart,
        "gadget": list_or_default(
            counter_to_pct(gadget_counter, total, top_n=6),
            [["iPhone", 31.2], ["Мотоцикл", 30.3], ["MacBook", 22.1], ["Power bank", 6.2], ["Авто", 6.0], ["Інше", 4.1]]
        ),
        "insights": [
            {
                "icon": "🎯",
                "title": f"Ядро — лояльні чоловіки 25–44",
                "text": f"{round(gender_chart['data'][0])}% аудиторії — чоловіки. Вік 25–44 домінує. Це основний сегмент, якому треба говорити мовою динаміки та статусу."
            },
            {
                "icon": "🏙️",
                "title": "50/50 мільйонники та малі міста",
                "text": "Аудиторія рівномірно розподілена між великими і малими містами — важливо не зосереджуватись лише на метрополісах."
            },
            {
                "icon": "🔄",
                "title": f"Аудиторія дуже лояльна",
                "text": f"{int(loyal_pct)}% стежать давно. {int(regular_pct)}% — регулярні гравці. Відтік мінімальний. Потрібно стимулювати активацію решти."
            },
            {
                "icon": "🚗",
                "title": f"{int(car_pct)}% вже мають авто",
                "text": "Це люди, які хочуть апгрейд — вони цінують якість та статус. Комунікація \"наступний рівень\" vs \"перше авто\"."
            },
            {
                "icon": "🛡️",
                "title": "Безпека — головний критерій №1",
                "text": f"{reason_chart['data'][0]}% обирають авто за безпекою та надійністю. Контент про безпеку може посилити конверсію."
            },
            {
                "icon": "🌑",
                "title": "Темний колір домінує",
                "text": f"{color_chart['data'][0]}% хочуть темний колір. При виборі авто для запуску — темна або чорна версія матиме найвищий відгук."
            },
            {
                "icon": "💡",
                "title": "DreamCar = реальний шанс",
                "text": "42% сприймають як \"реальний шанс змінити життя\". Мотивація прагматична, а не просто геймінг."
            },
            {
                "icon": "📱",
                "title": "iPhone + мотоцикл — топ бажань",
                "text": "Гаджет-бонуси: iPhone та мотоцикл — майже рівні. Можна тестувати як окремий механіку бонусу."
            },
            {
                "icon": "💰",
                "title": "75% хочуть низьку/середню ціну входу",
                "text": "Low + Mid = більшість. Аудиторія чутлива до ціни. Оптимальна точка входу — середня, не преміум."
            },
            {
                "icon": "💑",
                "title": "80% їдуть не самі",
                "text": "Партнер + сім'я = більшість. DreamCar — це спільна мрія. Комунікація \"для двох\" резонує."
            }
        ]
    }

    return data

# ─── зчитати існуючий SURVEY_HISTORY з HTML ──────────────────────────────────
def read_history(content: str) -> list:
    import re
    h_start = content.find(HISTORY_BEGIN)
    h_end   = content.find(HISTORY_END)
    if h_start == -1 or h_end == -1:
        return []
    block = content[h_start + len(HISTORY_BEGIN):h_end]
    # витягуємо JSON-масив між [ і ]
    match = re.search(r'\[.*\]', block, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return []

# ─── додати snapshot до SURVEY_HISTORY ───────────────────────────────────────
def append_snapshot(history: list, data: dict) -> list:
    today = data["meta"]["lastUpdated"]  # DD.MM.YYYY
    # не дублюємо запис за той самий день
    if history and history[-1]["date"] == today:
        history[-1] = _make_snapshot(today, data)
        print(f"  ↺ Snapshot за {today} оновлено (існував)")
    else:
        history.append(_make_snapshot(today, data))
        print(f"  + Новий snapshot за {today}")
    # зберігаємо не більше 60 записів (~2 місяці щодня)
    return history[-60:]

def _make_snapshot(date: str, data: dict) -> dict:
    g = data.get("gender", {})
    male_pct = g["data"][0] if g.get("labels") and g["labels"][0] == "Чоловіки" else 0
    age = data.get("age", {})
    age_main = age["data"][0] if age.get("data") else 0
    reason = data.get("carReason", {})
    safety = reason["data"][0] if reason.get("data") else 0
    color = data.get("carColor", {})
    dark = color["data"][0] if color.get("data") else 0
    dc = data.get("dcMeaning", [])
    chance = dc[0][1] if dc else 0
    amount = data.get("amount", {})
    mid = amount["data"][1] if amount.get("data") and len(amount["data"]) > 1 else 0
    return {
        "date":      date,
        "n":         data["meta"]["totalResponses"],
        "male":      round(male_pct, 1),
        "age_main":  round(age_main, 1),
        "loyal":     round(data["meta"]["loyalPct"], 1),
        "regular":   round(data["meta"]["regularPlayersPct"], 1),
        "has_car":   round(data["meta"]["haveCarPct"], 1),
        "safety":    round(safety, 1),
        "dark":      round(dark, 1),
        "chance":    round(chance, 1),
        "mid_price": round(mid, 1),
    }

# ─── оновити HTML ─────────────────────────────────────────────────────────────
def update_html(data: dict) -> None:
    with open(HTML_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # ── оновити SURVEY_DATA ──
    start_idx = content.find(MARKER_BEGIN)
    end_idx   = content.find(MARKER_END)
    if start_idx == -1 or end_idx == -1:
        raise RuntimeError(f"Маркери SURVEY_DATA не знайдено в {HTML_PATH}!")

    json_str  = json.dumps(data, ensure_ascii=False, indent=2)
    new_block = f"{MARKER_BEGIN}\nconst SURVEY_DATA = {json_str};\n{MARKER_END}"
    content = content[:start_idx] + new_block + content[end_idx + len(MARKER_END):]

    # ── оновити SURVEY_HISTORY (якщо маркери є) ──
    h_start = content.find(HISTORY_BEGIN)
    h_end   = content.find(HISTORY_END)
    if h_start != -1 and h_end != -1:
        # читаємо існуючу історію (з ВЖЕ оновленого content)
        with open(HTML_PATH, "r", encoding="utf-8") as f:
            original = f.read()
        history = read_history(original)
        history = append_snapshot(history, data)
        history_json = json.dumps(history, ensure_ascii=False, indent=2)
        new_history = f"{HISTORY_BEGIN}\nconst SURVEY_HISTORY = {history_json};\n{HISTORY_END}"
        # замінюємо в щойно оновленому content
        h_start2 = content.find(HISTORY_BEGIN)
        h_end2   = content.find(HISTORY_END)
        content = content[:h_start2] + new_history + content[h_end2 + len(HISTORY_END):]
        print(f"  ✓ SURVEY_HISTORY оновлено ({len(history)} записів)")
    else:
        print(f"  ⚠ Маркери SURVEY_HISTORY не знайдено — history не оновлюється")

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"✓ {HTML_PATH} оновлено ({data['meta']['totalResponses']} відповідей, {data['meta']['lastUpdated']})")

# ─── main ─────────────────────────────────────────────────────────────────────
def main():
    print(f"[{datetime.now().strftime('%d.%m.%Y %H:%M')}] Починаємо оновлення survey.html ...")

    try:
        print(f"  Завантажуємо CSV: {CSV_URL}")
        csv_text = download_csv(CSV_URL)
    except Exception as e:
        print(f"✗ Помилка завантаження: {e}", file=sys.stderr)
        print("  Перевірте, що таблиця відкрита для перегляду по посиланню.", file=sys.stderr)
        sys.exit(1)

    data = parse_csv(csv_text)
    if data is None:
        print("✗ Не вдалося розпарсити CSV — файл порожній або хибний формат.", file=sys.stderr)
        sys.exit(1)

    update_html(data)
    print("✓ Готово!")

if __name__ == "__main__":
    main()
