#!/usr/bin/env python3
"""
DreamCar — MTProto stats sync для TG постів (#243)

Тягне real views/reactions/forwards з Telegram MTProto API через Telethon.
TG Bot API цю інфу НЕ дає — тому окремий worker.

Flow:
1. Login через session_string (одноразово згенерований через generate_session.py)
2. SELECT tg_post_analytics WHERE last_synced_at < now() - 30min (або null)
3. Для кожного: client.get_messages(chat_id, ids=[message_id])
4. Update views, reactions (jsonb {emoji: count}), forwards
5. Set last_synced_at = now()

ENV:
  TG_API_ID         — з https://my.telegram.org/apps
  TG_API_HASH       — звідти ж
  TG_SESSION_STRING — згенерований через generate_session.py (одноразово)
  SUPABASE_URL      — Supabase REST endpoint
  SUPABASE_SERVICE_KEY — service_role key
"""
import os
import sys
import json
import time
import asyncio
import logging
from datetime import datetime, timezone

import httpx
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import Message, ReactionCount, ReactionEmoji, ReactionCustomEmoji

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

# #313: graceful skip коли MTProto secrets не виставлені.
# Раніше int('') кидав ValueError → workflow failed → email spam кожні 30хв.
_api_id_raw = os.environ.get('TG_API_ID', '').strip()
API_HASH = os.environ.get('TG_API_HASH', '').strip()
SESSION_STRING = os.environ.get('TG_SESSION_STRING', '').strip()
SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', '50'))

if not (_api_id_raw and API_HASH and SESSION_STRING):
    log.warning("[#313] MTProto secrets не налаштовані (TG_API_ID/TG_API_HASH/TG_SESSION_STRING). Skip без помилки.")
    log.warning("Щоб увімкнути — додай 3 secrets у Settings → Secrets → Actions:")
    log.warning("  1. TG_API_ID — з https://my.telegram.org → API development tools")
    log.warning("  2. TG_API_HASH — там же")
    log.warning("  3. TG_SESSION_STRING — через Telethon StringSession (див README)")
    sys.exit(0)  # exit 0 = success, щоб GH не показував failure

API_ID = int(_api_id_raw)
if not (SUPABASE_URL and SERVICE_KEY):
    log.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY у workflow env")
    sys.exit(1)


def supabase_headers():
    return {
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }


def fetch_pending() -> list:
    url = f"{SUPABASE_URL}/rest/v1/tg_post_analytics?select=id,publication_id,channel_id,message_id,last_synced_at,first_published_at&order=last_synced_at.asc.nullsfirst&limit={BATCH_SIZE}"
    r = httpx.get(url, headers=supabase_headers(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    now_ts = time.time()
    filtered = []
    for row in rows:
        ls = row.get('last_synced_at')
        if ls is None:
            filtered.append(row)
            continue
        try:
            ls_ts = datetime.fromisoformat(ls.replace('Z', '+00:00')).timestamp()
            if (now_ts - ls_ts) > 30 * 60:
                filtered.append(row)
        except Exception:
            filtered.append(row)
    return filtered


def update_analytics(row_id, views, reactions, reactions_total, forwards):
    body = {
        'views': views,
        'reactions': reactions,
        'reactions_total': reactions_total,
        'forwards': forwards,
        'last_synced_at': datetime.now(timezone.utc).isoformat()
    }
    url = f"{SUPABASE_URL}/rest/v1/tg_post_analytics?id=eq.{row_id}"
    r = httpx.patch(url, headers=supabase_headers(), json=body, timeout=15)
    if r.status_code >= 400:
        log.warning(f"Update fail {row_id}: {r.status_code} {r.text[:200]}")


def parse_reactions(msg):
    reactions = {}
    total = 0
    if msg.reactions and msg.reactions.results:
        for rc in msg.reactions.results:
            if not isinstance(rc, ReactionCount):
                continue
            emoji = ''
            if isinstance(rc.reaction, ReactionEmoji):
                emoji = rc.reaction.emoticon
            elif isinstance(rc.reaction, ReactionCustomEmoji):
                emoji = f'custom_{rc.reaction.document_id}'
            else:
                continue
            cnt = int(rc.count or 0)
            reactions[emoji] = cnt
            total += cnt
    return reactions, total


async def process_one(client, row):
    channel_id_str = row['channel_id']
    message_id = int(row['message_id'])
    try:
        chat_id = int(channel_id_str)
        messages = await client.get_messages(chat_id, ids=[message_id])
        msg = messages[0] if messages else None
        if not msg or not isinstance(msg, Message):
            log.warning(f"Msg not found {chat_id}/{message_id}")
            return False
        views = int(msg.views or 0)
        forwards = int(msg.forwards or 0)
        reactions, total = parse_reactions(msg)
        update_analytics(row['id'], views, reactions, total, forwards)
        log.info(f"OK {chat_id}/{message_id} views={views} reactions={total} forwards={forwards}")
        return True
    except Exception as e:
        log.error(f"Fail {row['id']}: {e}")
        return False


async def main():
    log.info(f"Fetching pending (batch={BATCH_SIZE})...")
    pending = fetch_pending()
    log.info(f"Got {len(pending)} stale records")
    if not pending:
        return
    log.info("Connecting MTProto...")
    async with TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH) as client:
        log.info("Connected")
        synced = 0
        failed = 0
        for row in pending:
            ok = await process_one(client, row)
            (synced if ok else failed)
            if ok: synced += 1
            else: failed += 1
            await asyncio.sleep(0.5)
        log.info(f"Done. synced={synced} failed={failed}")


if __name__ == '__main__':
    asyncio.run(main())
