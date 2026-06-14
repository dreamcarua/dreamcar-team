#!/usr/bin/env python3
"""
meta_digest.py — щоденний Telegram-дайджест Meta Ads аналітики DreamCar.

Читає ПУБЛІЧНИЙ data.json (GitHub Pages дашборду), формує зведення по активних
циклах + топ-рекомендації, шле DM Вадиму через @dreamcar_team_bot.

Ізольовано: лише читає data.json по HTTP, нічого не пише в БД/репо дашборду.
Секрети TG_BOT_TOKEN / TG_CHAT_ID вже існують у repo dreamcarua/dreamcar-team.
"""
import os, json, urllib.request, ssl
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
    NOW = datetime.now(ZoneInfo('Europe/Kyiv'))
except Exception:
    NOW = datetime.now(timezone.utc)

DATA_URL = os.getenv('META_DATA_URL', 'https://dashboard.dreamcar.ua/meta-analytics/data.json')
TG_TOKEN = os.getenv('TG_BOT_TOKEN', '')
TG_CHAT = os.getenv('TG_CHAT_ID', '')


def money(n):
    return f'{int(n or 0):,}'.replace(',', ' ')


def fetch():
    ctx = ssl.create_default_context()
    req = urllib.request.Request(DATA_URL, headers={'User-Agent': 'meta-digest'})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return json.load(r)


def build(payload):
    projects = payload.get('projects', [])
    cur = [p for p in projects if p.get('is_current')] or projects[-2:]
    tot_spend = sum(p.get('spend') or 0 for p in cur)
    tot_real = sum(p.get('real_ad_revenue') or 0 for p in cur)
    blended = round(tot_real / tot_spend, 2) if tot_spend else 0
    n_cri = sum(1 for p in cur for r in (p.get('recommendations') or []) if r.get('sev') == 'cri')

    lines = ['📊 <b>Meta Ads — щоденний дайджест</b>', f'<i>{NOW:%d.%m.%Y %H:%M} Київ</i>', '']
    lines.append(f'Активні цикли: <b>{len(cur)}</b> · витрати <b>{money(tot_spend)} ₴</b> · реал ROAS <b>{blended}</b>')
    if n_cri:
        lines.append(f'🔴 Критичних сигналів: <b>{n_cri}</b> — задачі у team.dreamcar.ua/tasks')
    lines.append('')

    for p in cur:
        lines.append(f'🏁 <b>{p.get("name")}</b> · {money(p.get("spend"))} ₴')
        lines.append(f'   ROAS: піксель {p.get("pixel_roas")} · реал {p.get("real_ad_roas")} · '
                     f'CPA {p.get("cpa")} ₴ · частота {p.get("frequency")}')
        for r in (p.get('recommendations') or [])[:3]:
            mark = '🔴' if r.get('sev') == 'cri' else ('🟡' if r.get('sev') == 'mod' else 'ℹ️')
            lines.append(f'   {mark} {r.get("text")}')
        lines.append('')

    lines.append('🔗 dashboard.dreamcar.ua/meta-analytics/')
    text = '\n'.join(lines)
    return text[:4000]


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
