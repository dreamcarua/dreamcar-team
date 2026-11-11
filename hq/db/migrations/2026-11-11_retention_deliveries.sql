-- 11.11.2026 · журнал доставок бот-розсилки: без нього надіслане неможливо виправити чи видалити.
-- retention-bot-broadcast пише сюди кожного отримувача і id усіх його повідомлень (текст/підпис/альбом/кнопки/кружечок);
-- ?action=edit|delete працює за цим журналом. Лише service_role.
CREATE TABLE IF NOT EXISTS public.retention_deliveries (
  retention_message_id uuid NOT NULL REFERENCES public.retention_messages(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{"id":123,"role":"text|caption|album|kb|vnote"}]
  sent_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  last_error text,
  PRIMARY KEY (retention_message_id, chat_id)
);
ALTER TABLE public.retention_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retention_deliveries FROM anon, authenticated;
ALTER TABLE public.retention_messages ADD COLUMN IF NOT EXISTS sent_edited_at timestamptz;
ALTER TABLE public.retention_messages ADD COLUMN IF NOT EXISTS sent_deleted_at timestamptz;
-- Відкат: DROP TABLE public.retention_deliveries; ALTER TABLE public.retention_messages DROP COLUMN sent_edited_at, DROP COLUMN sent_deleted_at;
