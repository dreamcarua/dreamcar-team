#!/usr/bin/env python3
"""
IG щоденний AI-дайджест → Supabase dashboard_ig_ai_daily + TG DM Вадиму.

Логіка:
  1. Читає dashboard_ig_account_daily + dashboard_ig_media (service role, PostgREST).
  2. Рахує метрики 2025-26 (ER by reach/followers, sends/reach, saves/reach, reach rate)
     + детермінований движок сигналів (rule-based).
  3. Викликає Anthropic API → стислий діловий бриф українською + рекомендації на сьогодні.
     Якщо ключа/виклику немає — fallback на rule-based текст (дайджест усе одно йде).
  4. Upsert у dashboard_ig_ai_daily (показується на сторінці HQ Instagram-аналітика).
  5. Шле DM Вадиму через @dreamcar_team_bot (sendMessage, HTML).

Усі дати — Europe/Kyiv.

Env (secrets dreamcar-team):
  HQ_DB_URL, HQ_DB_SERVICE_KEY     — Supabase (service role)
  ANTHROPIC_API_KEY                — Claude API (опц., є fallback)
  ANTHROPIC_MODEL                  — опц., дефолт claude-haiku-4-5-20251001
  TG_BOT_TOKEN, TG_CHAT_ID         — DM Вадима
"""
import os, json, statistics
from datetime import datetime, timedelta, timezone
import requests

SB_URL = (os.getenv('HQ_DB_URL') or os.getenv('SUPABASE_URL') or '').rstrip('/')
SB_KEY = os.getenv('HQ_DB_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY') or ''
ANTHROPIC_KEY = os.getenv('ANTHROPIC_API_KEY', '')
ANTHROPIC_MODEL = os.getenv('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001')
TG_TOKEN = os.getenv('TG_BOT_TOKEN', '')
TG_CHAT = os.getenv('TG_CHAT_ID', '')
DASH_URL = 'https://team.dreamcar.ua/hq/instagram-analytics.html'

H = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'}


def log(m):
    print(f'[{datetime.now(timezone.utc):%H:%M:%S}] {m}', flush=True)


def kyiv_now():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo('Europe/Kyiv'))
    except Exception:
        return datetime.now(timezone.utc) + timedelta(hours=3)


def sb_get(path):
    r = requests.get(f'{SB_URL}/rest/v1/{path}', headers=H, timeout=60)
    r.raise_for_status()
    return r.json()


def fnum(n):
    return '—' if n is None else f'{round(n):,}'.replace(',', ' ')


def r2(n, d=2):
    return None if n is None else round(n, d)


def avg(arr):
    arr = [x for x in arr if x is not None]
    return sum(arr) / len(arr) if arr else None


def compute():
    acct = sb_get('dashboard_ig_account_daily?select=*&order=date')
    cutoff = (kyiv_now().date() - timedelta(days=90)).isoformat()
    media = sb_get(f'dashboard_ig_media?select=*&published_at=gte.{cutoff}T00:00:00&order=published_at')
    today = acct[-1] if acct else {}
    followers = today.get('followers_count') or 350000

    M = []
    for m in media:
        if not m.get('reach'):
            continue
        reach = m['reach']
        inter = m.get('total_interactions')
        if inter is None:
            inter = (m.get('like_count') or 0) + (m.get('comments_count') or 0) + (m.get('saved') or 0) + (m.get('shares') or 0)
        M.append({
            'fmt': (m.get('media_product_type') or 'FEED').upper(),
            'reach': reach,
            'er_reach': inter / reach * 100,
            'er_foll': ((m.get('like_count') or 0) + (m.get('comments_count') or 0)) / followers * 100,
            'sends_r': (m.get('shares') or 0) / reach * 100,
            'saves_r': (m.get('saved') or 0) / reach * 100,
            'reach_rate': reach / followers * 100,
            'dt': m.get('published_at'),
            'permalink': m.get('permalink'),
        })

    # weekly ER trend delta (друга половина vs перша)
    def half_delta(key):
        if len(M) < 6:
            return None
        h = len(M) // 2
        a = avg([x[key] for x in M[:h]])
        b = avg([x[key] for x in M[h:]])
        return round((b - a) / a * 100) if a else None

    fmts = {}
    for f in ('REELS', 'FEED'):
        a = [x for x in M if x['fmt'] == f]
        fmts[f] = {'n': len(a), 'er': avg([x['er_reach'] for x in a]), 'sends': avg([x['sends_r'] for x in a]), 'saves': avg([x['saves_r'] for x in a])}

    # follower delta from history
    foll_series = [a.get('followers_count') for a in acct if a.get('followers_count')]
    foll_delta = (foll_series[-1] - foll_series[0]) if len(foll_series) >= 2 else None

    metrics = {
        'followers': followers,
        'followers_delta': foll_delta,
        'er_reach': r2(avg([x['er_reach'] for x in M])),
        'er_foll': r2(avg([x['er_foll'] for x in M])),
        'sends_r': r2(avg([x['sends_r'] for x in M])),
        'saves_r': r2(avg([x['saves_r'] for x in M])),
        'reach_rate': r2(avg([x['reach_rate'] for x in M]), 1),
        'er_trend_pct': half_delta('er_reach'),
        'reach_rate_trend_pct': half_delta('reach_rate'),
        'posts_90d': len(M),
        'profile_views_30d': today.get('profile_views'),
        'website_clicks_30d': today.get('website_clicks'),
        'fmt_reels': fmts['REELS'],
        'fmt_feed': fmts['FEED'],
    }
    return metrics, M


def rule_signals(mt):
    s = []
    if mt['er_trend_pct'] is not None and mt['er_trend_pct'] <= -15:
        s.append(f"⚠ ER by reach впав на {abs(mt['er_trend_pct'])}% — перевірити перенасичення промо-контентом.")
    re, fe = mt['fmt_reels'], mt['fmt_feed']
    if re['er'] and fe['er']:
        if fe['er'] > re['er'] * 1.2:
            s.append(f"◆ Каруселі/стрічка ER {round(fe['er'],2)}% > Reels {round(re['er'],2)}% — більше каруселей-добірок.")
        elif re['er'] > fe['er'] * 1.2:
            s.append(f"✅ Reels ER {round(re['er'],2)}% лідирує — масштабувати короткі відео з сильним гаком.")
    if mt['sends_r'] and mt['sends_r'] >= 1:
        s.append(f"✅ Sends/reach {mt['sends_r']}% — сильні репости (головний сигнал 2026).")
    if mt['saves_r'] is not None and mt['saves_r'] < 0.5:
        s.append(f"◆ Saves/reach {mt['saves_r']}% нижче 0.5% — більше «зберігального» контенту (чек-листи, поради).")
    if mt['reach_rate_trend_pct'] is not None and mt['reach_rate_trend_pct'] <= -10:
        s.append(f"⚠ Reach rate -{abs(mt['reach_rate_trend_pct'])}% — охоплення холоне, освіжити формати.")
    if mt['er_foll'] is not None and mt['er_foll'] < 0.48:
        s.append(f"◆ ER by followers {mt['er_foll']}% < ринку 0.48% — більше інтерактиву в перші 2 год.")
    return s


def ai_summary(mt, signals):
    if not ANTHROPIC_KEY:
        return None
    sys = ("Ти head of SMM-аналітики DreamCar (укр. авто-клуб, IG @dreamcar.ua, ~350k). "
           "Дай стислий ранковий бриф українською (діловий тон, без води, без емодзі-спаму). "
           "Структура: 1 рядок — стан; 2-3 конкретні рекомендації на сьогодні з цифрами. "
           "Спирайся на метрики 2025-26: north-star = sends/reach і saves/reach, ER by reach — якість, "
           "ER by followers — порівняння з ринком (0.48%). Максимум 900 символів.")
    usr = f"Метрики (90 днів):\n{json.dumps(mt, ensure_ascii=False, indent=1)}\n\nДетерміновані сигнали:\n" + "\n".join(signals)
    try:
        r = requests.post('https://api.anthropic.com/v1/messages',
            headers={'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
            json={'model': ANTHROPIC_MODEL, 'max_tokens': 700,
                  'system': sys, 'messages': [{'role': 'user', 'content': usr}]}, timeout=60)
        if r.status_code == 200:
            return ''.join(b.get('text', '') for b in r.json().get('content', [])).strip()
        log(f'  ⚠ Anthropic {r.status_code}: {r.text[:200]}')
    except Exception as e:
        log(f'  ⚠ Anthropic exc: {e}')
    return None


def upsert_ai(date_iso, summary, recs, mt):
    body = [{'date': date_iso, 'summary': summary, 'recommendations': recs, 'metrics': mt,
             'model': ANTHROPIC_MODEL if ANTHROPIC_KEY and summary else 'rule-based'}]
    r = requests.post(f'{SB_URL}/rest/v1/dashboard_ig_ai_daily?on_conflict=date',
                      headers={**H, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'},
                      json=body, timeout=60)
    log(f'  {"✓" if r.ok else "⚠"} ai_daily upsert {r.status_code}')


def send_tg(mt, summary, signals):
    if not (TG_TOKEN and TG_CHAT):
        log('  ⚠ нема TG_BOT_TOKEN/TG_CHAT_ID — DM пропущено')
        return
    d = kyiv_now()
    arrow = lambda v: ('▲' if v and v > 0 else ('▼' if v and v < 0 else '■')) + (f'{abs(v)}%' if v is not None else '')
    lines = [
        f'📸 <b>Instagram-дайджест</b> · <i>{d:%d.%m %H:%M} Київ</i>',
        f'@dreamcar.ua · {fnum(mt["followers"])} підписників',
        '',
        f'• Sends/reach: <b>{mt["sends_r"]}%</b>   • Saves/reach: <b>{mt["saves_r"]}%</b>',
        f'• ER by reach: <b>{mt["er_reach"]}%</b> {arrow(mt["er_trend_pct"])}   • ER by followers: <b>{mt["er_foll"]}%</b> (ринок 0.48%)',
        f'• Reach rate: <b>{mt["reach_rate"]}%</b> {arrow(mt["reach_rate_trend_pct"])}   • Постів/90д: {mt["posts_90d"]}',
    ]
    if summary:
        lines += ['', '<b>AI-аналітик:</b>', summary]
    else:
        lines += ['', '<b>Сигнали:</b>'] + [f'• {s}' for s in signals[:5]]
    lines += ['', f'📊 <a href="{DASH_URL}">Повний дашборд</a>']
    text = '\n'.join(lines)[:4000]
    r = requests.post(f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
                      json={'chat_id': TG_CHAT, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': True}, timeout=30)
    log(f'  {"✓" if r.status_code == 200 else "⚠"} TG {r.status_code}: {r.text[:150] if r.status_code!=200 else "sent"}')


def main():
    if not (SB_URL and SB_KEY):
        log('❌ нема HQ_DB_URL/HQ_DB_SERVICE_KEY'); raise SystemExit(1)
    log('🚀 IG digest')
    mt, M = compute()
    log(f'  метрики: ER reach {mt["er_reach"]}% · sends/reach {mt["sends_r"]}% · постів {mt["posts_90d"]}')
    signals = rule_signals(mt)
    summary = ai_summary(mt, signals)
    log(f'  AI: {"✓ " + ANTHROPIC_MODEL if summary else "fallback rule-based"}')
    upsert_ai(kyiv_now().date().isoformat(), summary, signals, mt)
    send_tg(mt, summary, signals)
    log('✅ done')


if __name__ == '__main__':
    main()
