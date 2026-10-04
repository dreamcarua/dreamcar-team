-- 037 (D): auth_rls_initplan — kasa_fop_alert_log.auth_read_ceo_coo_cfo
-- auth.uid() обгортаємо в (select auth.uid()) → оцінюється ОДИН раз (initplan),
-- а не на кожен рядок. Логіка не змінюється. ALTER POLICY атомарний (без вікна).
-- Відкат: ALTER POLICY ... USING (... auth.uid() ...) без (select ...).

ALTER POLICY auth_read_ceo_coo_cfo ON public.kasa_fop_alert_log
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.auth_id = (select auth.uid())
    AND u.role = ANY (ARRAY['ceo'::user_role, 'coo'::user_role, 'cfo'::user_role])
));
