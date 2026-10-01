-- 032 (01.10.2026): гранти для ролі 'media' + призначення зовнішнім підрядникам.
-- 'media' НЕ входить у жоден team-read список (finances/analytics/launches/...)
-- і НЕ потребує членства у столі → бачить ВИКЛЮЧНО creatives (read-only).
-- Запускати ПІСЛЯ успішного 031 (enum-значення має бути закомічене).

-- read-only Бібліотека для ролі media (без desk_members)
drop policy if exists "creatives: read by media role" on public.creatives;
create policy "creatives: read by media role"
  on public.creatives for select
  using (current_user_has_role(array['media'::user_role]) and deleted_at is null);

-- призначити роль media зовнішнім користувачам + активувати
update public.users set role = 'media', is_active = true, updated_at = now()
where email in ('stadnik@srvi.net','yakovenkogrisha@gmail.com');
