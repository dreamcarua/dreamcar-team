-- ============================================================
-- Migration 018 — HEVC (H.265) variant support
-- ============================================================
-- Worker з ENABLE_HEVC=1 буде створювати другий варіант відео
-- з кращою якістю (HEVC main profile) і зберігати URL тут.
-- Autopost у майбутньому може спробувати HEVC спочатку, фолбек H.264.

alter table creatives
  add column if not exists compressed_url_hevc        text,
  add column if not exists compressed_hevc_size_bytes bigint,
  add column if not exists compressed_hevc_at         timestamptz;

comment on column creatives.compressed_url_hevc is 'H.265/HEVC варіант для клієнтів з апаратним декодером. Опційний.';
