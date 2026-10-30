"""
media_backfill.py (30.10.2026) — підтягнути у медіатеку HQ файли, які вже лежать у чаті
«DreamCar Media» (бот Bot API не бачить історію чату, тому через MTProto-сесію Telethon).
Також знімає ліміт 20 МБ: Telethon качає файли будь-якого розміру.

Env: TG_API_ID, TG_API_HASH, TG_SESSION_STRING, SUPABASE_URL, SUPABASE_SERVICE_KEY
     CHAT_ID (default -1003912295530), SINCE (YYYY-MM-DD, Київ; default сьогодні),
     FROM_ID (tg id відправника; порожньо = усі), ONLY_TOO_BIG=1 — лише файли зі статусом too_big.
У лог не пишуться імена чи вміст, лише лічильники та message_id.
"""
import asyncio, datetime as dt, mimetypes, os, sys, uuid, time
from zoneinfo import ZoneInfo
import httpx
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument, DocumentAttributeVideo, DocumentAttributeFilename, DocumentAttributeAnimated, PeerChannel

SB = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
CHAT_ID = int(os.environ.get("CHAT_ID") or "-1003912295530")
KYIV = ZoneInfo("Europe/Kyiv")
since_s = (os.environ.get("SINCE") or "").strip()
SINCE = (dt.datetime.fromisoformat(since_s) if since_s else dt.datetime.now(KYIV).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)).replace(tzinfo=KYIV)
FROM_ID = int(os.environ["FROM_ID"]) if (os.environ.get("FROM_ID") or "").strip() else None
ONLY_TOO_BIG = os.environ.get("ONLY_TOO_BIG") == "1"
DESK = "11111111-1111-1111-1111-111111111111"
OWNER = "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def sb_get(path, params):
    r = httpx.get(f"{SB}/rest/v1/{path}", headers=H, params=params, timeout=30); r.raise_for_status(); return r.json()

def sb_post(path, body, prefer="return=representation"):
    r = httpx.post(f"{SB}/rest/v1/{path}", headers={**H, "content-type": "application/json", "Prefer": prefer}, json=body, timeout=60)
    if r.status_code >= 300: raise RuntimeError(f"{path} {r.status_code} {r.text[:200]}")
    return r.json() if r.text else None

def guess_launch():
    r = httpx.post(f"{SB}/rest/v1/rpc/library_guess_launch", headers={**H, "content-type": "application/json"}, json={"p_at": dt.datetime.now(dt.timezone.utc).isoformat()}, timeout=30)
    return r.json() if r.status_code == 200 else None

def classify(msg):
    """→ (kind, mime, name, w, h, dur, uid) або None"""
    m = msg.media
    if isinstance(m, MessageMediaPhoto) and m.photo:
        sz = max((s for s in m.photo.sizes if hasattr(s, "w")), key=lambda s: s.w * s.h, default=None)
        return ("photo", "image/jpeg", None, getattr(sz, "w", None), getattr(sz, "h", None), None, f"mt-photo-{m.photo.id}")
    if isinstance(m, MessageMediaDocument) and m.document:
        d = m.document; mime = (d.mime_type or "").lower()
        name = next((a.file_name for a in d.attributes if isinstance(a, DocumentAttributeFilename)), None)
        vid = next((a for a in d.attributes if isinstance(a, DocumentAttributeVideo)), None)
        if getattr(vid, "round_message", False): return None  # кружечки не беремо
        if mime.startswith("image/"):
            return ("photo", mime, name, None, None, None, f"mt-doc-{d.id}")
        if mime.startswith("video/") or any(isinstance(a, DocumentAttributeAnimated) for a in d.attributes):
            return ("video", mime or "video/mp4", name, getattr(vid, "w", None), getattr(vid, "h", None), int(getattr(vid, "duration", 0) or 0) or None, f"mt-doc-{d.id}")
    return None

async def main():
    client = TelegramClient(StringSession(os.environ["TG_SESSION_STRING"]), int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"])
    await client.connect()
    if not await client.is_user_authorized():
        print("::error::MTProto session not authorized"); sys.exit(1)
    try:
        chat = await client.get_entity(PeerChannel(int(str(CHAT_ID).replace("-100", ""))))
    except Exception as e:
        print(f"::error::session account cannot open the Media chat: {type(e).__name__}"); sys.exit(1)

    launch = guess_launch()
    users = {u["tg_chat_id"]: u["id"] for u in sb_get("users", {"select": "id,tg_chat_id", "tg_chat_id": "not.is.null"}) if u.get("tg_chat_id")}
    too_big_ids = None
    if ONLY_TOO_BIG:
        rows = sb_get("tg_media_intake", {"select": "message_id", "chat_id": f"eq.{CHAT_ID}", "status": "eq.too_big"})
        too_big_ids = {r["message_id"] for r in rows}

    stats = {"seen": 0, "saved": 0, "dup": 0, "skip": 0, "err": 0}
    async for msg in client.iter_messages(chat, offset_date=None, reverse=False):
        if msg.date < SINCE: break
        if not msg.media: continue
        if FROM_ID and msg.sender_id != FROM_ID: continue
        if too_big_ids is not None and msg.id not in too_big_ids: continue
        snd = await msg.get_sender()
        if getattr(snd, "bot", False): continue  # архівні пости самого бота вже з медіатеки
        c = classify(msg)
        if not c: stats["skip"] += 1; continue
        stats["seen"] += 1
        kind, mime, name, w, h, dur, uid = c
        # вже збережено (ботом або попереднім запуском)?
        exists = sb_get("tg_media_intake", {"select": "id", "chat_id": f"eq.{CHAT_ID}", "message_id": f"eq.{msg.id}", "status": "in.(saved,duplicate)"})
        if exists: stats["dup"] += 1; continue
        try:
            data = await client.download_media(msg, file=bytes)
            ext = (name.rsplit(".", 1)[-1].lower() if name and "." in name else (mimetypes.guess_extension(mime) or ".bin").lstrip("."))
            obj = f"tg/{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}.{ext}"
            r = httpx.post(f"{SB}/storage/v1/object/creatives/{obj}", headers={**H, "content-type": mime, "x-upsert": "false"}, content=data, timeout=600)
            if r.status_code >= 300: raise RuntimeError(f"storage {r.status_code}")
            pub = f"{SB}/storage/v1/object/public/creatives/{obj}"
            row = {"desk_id": DESK, "uploaded_by": users.get(msg.sender_id, OWNER), "name": (name or (msg.message or "").split("\n")[0] or f"tg_{msg.id}")[:200],
                   "type": kind, "drive_file_id": obj, "size_bytes": len(data), "width_px": w, "height_px": h, "duration_sec": dur,
                   "tags": ["tg-media"], "launch_id": launch, "folder_source": "tg_media"}
            if kind == "photo": row.update({"thumbnail_url": pub, "compressed_url": pub, "compressed_status": "ready"})
            cr = sb_post("creatives", row)[0]
            sb_post("tg_media_intake?on_conflict=chat_id,message_id,file_unique_id", {
                "chat_id": CHAT_ID, "message_id": msg.id, "media_group_id": str(msg.grouped_id) if msg.grouped_id else None,
                "file_unique_id": uid, "kind": kind, "mime": mime, "file_name": name, "size_bytes": len(data),
                "from_tg_id": msg.sender_id, "caption": msg.message or None, "launch_id": launch, "creative_id": cr["id"],
                "status": "saved", "acked_at": dt.datetime.now(dt.timezone.utc).isoformat()}, prefer="resolution=merge-duplicates,return=minimal")
            stats["saved"] += 1
            print(f"saved msg {msg.id} ({kind}, {len(data)//1024} KB)")
        except Exception as e:
            stats["err"] += 1; print(f"::warning::msg {msg.id}: {type(e).__name__}: {str(e)[:120]}")
    print("RESULT", stats, "since", SINCE.isoformat())
    await client.disconnect()

asyncio.run(main())
