#!/usr/bin/env python3
"""
meta_digest.py — щоденний Telegram-дайджест Meta Ads аналітики DreamCar.

Лід — денний зріз (payload.daily, за ВЧОРА): витрати, покупки, CPA, частота,
ROAS піксель/реал. Далі — активні цикли + стратегічні рекомендації.
Шле DM Вадиму через @dreamcar_team_bot.

Ізольовано: лише читає публічний data.json по HTTP, нічого не пише в БД/репо.
Секрети TG_BOT_TOKEN / TG_CHAT_ID існують у repo dreamcarua/dreamcar-team.
"""
import os, json, urllib.request, ssl
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
    NOW = datetime.now(ZoneInfo('Europe/Kyiv'))
except Exception:
    NOW = datetime.now(timezone.utc)

DATA_URL = os.getenv('META_DATA_URL',
                     'https://raw.githubusercontent.com/dreamcarua/dreamcar-dashboard/main/docs/meta-analytics/data.json')
DATA_FALLBACK = 'https://dashboard.dreamcar.ua/meta-analytics/data.json'
TG_TOKEN = os.getenv('TG_BOT_TOKEN', '')
TG_CHAT = os.getenv('TG_CHAT_ID', '')


def money(n):
    return f'{int(n or 0):,}'.replace(',', ' ')


def dmy(iso):
    try:
        return datetime.strptime(iso, '%Y-%m-%d').strftime('%d.%m.%Y')
    except Exception:
        return iso or ''


def _get(url):
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 meta-digest'})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return json.load(r)


def fetch():
    try:
        return _get(DATA_URL)
    except Exception as e:
        print('⚠ primary fetch failed:', e, '- пробую fallback')
        return _get(DATA_FALLBACK)


def build(payload):
    projects = payload.get('projects', [])
    daily = payload.get('daily')
    by_name = {p.get('name'): p for p in projects}

    if daily:
        active = daily.get('active_cycles') or []
        cyc = [by_name[n] for n in active if n in by_name] or [p for p in projects if p.get('is_current')]
        n_cri = sum(1 for p in cyc for r in (p.get('recommendations') or []) if r.get('sev') == 'cri')

        lines = [f'📊 <b>Meta Ads — дайджест за {dmy(daily.get("date"))}</b>',
                 f'<i>сформовано {NOW:%d.%m %H:%M} Київ</i>', '']
        lines.append(f'💰 Витрати <b>{money(daily.get("spend"))} ₴</b> · '
                     f'{daily.get("purchases") or 0} покупок · CPA {daily.get("cpa")} ₴ · частота {daily.get("frequency")}')
        lines.append(f'📈 ROAS: піксель <b>{daily.get("pixel_roas")}</b> · реал <b>{daily.get("real_ad_roas")}</b>')
        if n_cri:
            lines.append(f'🔴 Критичних сигналів: <b>{n_cri}</b> — задачі у team.dreamcar.ua/tasks')
        lines.append('')
        lines.append(f'🏁 Активні цикли: <b>{", ".join(active) if active else "—"}</b>')

        seen, recs = set(), []
        for p in cyc:
            for r in (p.get('recommendations') or []):
                key = r.get('text')
                if key in seen:
                    continue
                seen.add(key)
                recs.append(r)
        order = {'cri': 0, 'mod': 1, 'inf': 2}
        recs.sort(key=lambda r: order.get(r.get('sev'), 3))
        if recs:
            lines.append('<b>Рекомендації по циклу:</b>')
            for r in recs[:4]:
                mark = '🔴' if r.get('sev') == 'cri' else ('🟡' if r.get('sev') == 'mod' else 'ℹ️')
                lines.append(f'   {mark} {r.get("text")}')
        lines.append('')
        lines.append('🔗 dashboard.dreamcar.ua/meta-analytics/')
        return '\n'.join(lines)[:4000]

    # fallback (нема daily): зведення по поточних циклах за весь цикл
    cur = [p for p in projects if p.get('is_current')] or projects[-2:]
    lines = ['📊 <b>Meta Ads — дайджест</b>', f'<i>{NOW:%d.%m %H:%M} Київ</i>',
             '<i>(денний зріз недоступний — показано за цикл)</i>', '']
    for p in cur:
        lines.append(f'🏁 <b>{p.get("name")}</b> · {money(p.get("spend"))} ₴ за цикл')
        lines.append(f'   ROAS: піксель {p.get("pixel_roas")} · реал {p.get("real_ad_roas")} · частота {p.get("frequency")}')
        for r in (p.get('recommendations') or [])[:3]:
            mark = '🔴' if r.get('sev') == 'cri' else ('🟡' if r.get('sev') == 'mod' else 'ℹ️')
            lines.append(f'   {mark} {r.get("text")}')
        lines.append('')
    lines.append('🔗 dashboard.dreamcar.ua/meta-analytics/')
    return '\n'.join(lines)[:4000]


def send(text):
    if not (TG_TOKEN and TG_CHAT):
        print('⚠ нема TG_BOT_TOKEN/TG_CHAT_ID — пропуск'); return
    data = json.dumps({'chat_id': TG_CHAT, 'text': text, 'parse_mode': 'HTML',
                       'disable_web_page_preview': True}).encode()
    req = urllib.request.Request(f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
                                 data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        print('✅ TG', r.status)


if __name__ == '__main__':
    try:
        payload = fetch()
    except Exception as e:
        print('⚠ fetch failed:', e); raise SystemExit(0)
    msg = build(payload)
    print(msg)
    send(msg)
