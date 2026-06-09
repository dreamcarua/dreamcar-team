#!/usr/bin/env python3
"""
ОДНОРАЗОВО: генерує SESSION_STRING для tg-stats-mtproto worker.

ВАЖЛИВО: SESSION_STRING = повний доступ до того TG акаунта яким залогінився!
Не використовуй основний акаунт. Створи окремий dummy (новий номер) → додай
його як admin до dreamcar production channel → запусти цей скрипт.

Як:
1. pip install telethon
2. python etl/generate_session.py
3. Введи API_ID + API_HASH (з https://my.telegram.org/apps)
4. Введи номер
5. Введи код з SMS/TG
6. Скопіюй вивід → додай у GH Actions secret TG_SESSION_STRING
"""
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession


async def main():
    api_id = int(input("API_ID: "))
    api_hash = input("API_HASH: ")
    async with TelegramClient(StringSession(), api_id, api_hash) as client:
        await client.start()
        print()
        print("=" * 60)
        print("SESSION_STRING (додай у GH Actions secret TG_SESSION_STRING):")
        print()
        print(client.session.save())
        print()
        print("=" * 60)


if __name__ == '__main__':
    asyncio.run(main())
