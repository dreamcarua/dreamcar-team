-- 033 (04.10.2026): міст між двома реєстрами проєктів.
-- dashboard_projects (код stats) і launches (код P&L, через dashboard_project_pnl())
-- мають РІЗНІ коди. Раніше мапінг жив хардкодом у фронті (PNL_CODE_ALIAS).
-- Переносимо його в дані: нова колонка launch_code = код у P&L-реєстрі.
-- Аддитивно й безпечно: нічого не перезаписуємо, лише додаємо колонку + backfill.

ALTER TABLE public.dashboard_projects ADD COLUMN IF NOT EXISTS launch_code text;

COMMENT ON COLUMN public.dashboard_projects.launch_code IS
  'Код цього проєкту у P&L-реєстрі launches (dashboard_project_pnl.code). Міст між двома реєстрами. NULL = немає P&L (архів).';

-- backfill: усі 13 проєктів, що мають відповідник у dashboard_project_pnl()
UPDATE public.dashboard_projects SET launch_code = v.lc FROM (VALUES
  ('audi_q7_prestige',   'audi_q7_prestige'),
  ('3iphone',            '3iphone'),
  ('bmw_x6m',            'X6M'),
  ('iphone_17_jul2026',  'iphone2'),
  ('mustang',            'mustang'),
  ('motorcycle_jun2026', 'MOTO'),
  ('iphone_17_jun2026',  'IPHONE17'),
  ('audi_e_tron',        'AUDI_ETRON'),
  ('bmw_x5_hybrid',      'DC17_X5'),
  ('mercedes_gle_coupe', 'MERCEDES_GLE'),
  ('bmw_330e_hybrid',    'bmw_330e_hybrid'),
  ('audi_q7',            'audi_q7'),
  ('volvo_xc90',         'volvo_xc90')
) AS v(code, lc)
WHERE public.dashboard_projects.code = v.code;
