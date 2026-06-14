#!/usr/bin/env python3
"""
meta_digest.py — щоденний Telegram-дайджест Meta Ads аналітики DreamCar.

Лід — денний зріз (payload.daily, за ВЧОРА) з дельтами день-до-дня.
Реал = ЛИШЕ реклама (placement-мітки utm_medium facebook_*/instagram_*), без органіки.
Лідер/слабкі — з РЕАЛЬНИХ ads за вчора. З циклу — стратегічні сигнали (вигорання, вік).

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


def kmoney(n):
    n = n or 0
    return f'{n/1000:.1f}k' if n >= 1000 else str(int(n))


def dmy(iso):
    try:
        return datetime.strptime(iso, '%Y-%m-%d').strftime('%d.%m.%Y')
    except Exception:
        return iso or ''


def ddmm(iso):
    return dmy(iso)[:5]


def darrow(v):
    if v is None:
        return ''
    return f' {"▲" if v >= 0 else "▼"}{abs(v):.0f}%'


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
        date_lbl = dmy(daily.get('date'))
        d = daily.get('deltas') or {}

        lines = [f'📊 <b>Meta Ads — дайджест за {date_lbl}</b>',
                 f'<i>сформовано {NOW:%d.%m %H:%M} Київ · дельта до {ddmm(daily.get("prev_date"))}</i>', '']
        lines.append(f'💰 Витрати <b>{money(daily.get("spend"))} ₴</b>{darrow(d.get("spend"))} · '
                     f'{daily.get("purchases") or 0} покупок{darrow(d.get("purchases"))} · CPA {daily.get("cpa")} ₴{darrow(d.get("cpa"))}')
        lines.append(f'📈 ROAS: піксель <b>{daily.get("pixel_roas")}</b>{darrow(d.get("pixel_roas"))} · реал-реклама <b>{daily.get("real_ad_roas")}</b> · частота {daily.get("frequency")}')

        rp = daily.get('real_by_placement') or []
        if rp:
            top_rp = ' · '.join(f'{c["placement"]} {kmoney(c["revenue"])}' for c in rp[:3])
            lines.append(f'💵 Реал по плейсментах: {top_rp}')
        lines.append('')
        lines.append(f'🏁 Активні цикли: <b>{", ".join(active) if active else "—"}</b>')

        recs = []
        top = daily.get('top_creatives') or []
        weak = daily.get('weak_creatives') or []
        if top:
            t = top[0]
            recs.append(('inf', f'Лідер за {date_lbl}: «{t["name"]}» ROAS {t["roas"]}, CTR {t.get("ctr")}% — масштабувати.'))
        if weak:
            nm = ', '.join(f'«{c["name"]}» (ROAS {c["roas"]})' for c in weak[:2])
            recs.append(('mod', f'Слабкі за {date_lbl}: {nm} — переглянути/вимкнути.'))

        seen = set()
        for p in cyc:
            for r in (p.get('recommendations') or []):
                txt = r.get('text', '')
                if txt.startswith('Лідер') or txt in seen:
                    continue
                seen.add(txt)
                recs.append((r.get('sev'), txt))

        order = {'cri': 0, 'mod': 1, 'inf': 2}
        recs.sort(key=lambda r: order.get(r[0], 3))
        if recs:
            lines.append('<b>Рекомендації:</b>')
            for sev, txt in recs[:5]:
                mark = '🔴' if sev == 'cri' else ('🟡' if sev == 'mod' else 'ℹ️')
                lines.append(f'   {mark} {txt}')
        lines.append('')
        lines.append('🔗 dashboard.dreamcar.ua/meta-analytics/')
        return '\n'.join(lines)[:4000]

    # fallback (нема daily)
    cur = [p for p in projects if p.get('is_current')] or projects[-2:]
    lines = ['📊 <b>Meta Ads — дайджест</b>', f'<i>{NOW:%d.%m %H:%M} Київ</i>',
             '<i>(денний зріз недоступний — показано за цикл)</i>', '']
    for p in cur:
        lines.append(f'🏁 <b>{p.get("name")}</b> · {money(p.get("spend"))} ₴ за цикл')
        lines.append(f'   ROAS: піксель {p.get("pixel_roas")} · реал-реклама {p.get("real_ad_roas")} · частота {p.get("frequency")}')
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
