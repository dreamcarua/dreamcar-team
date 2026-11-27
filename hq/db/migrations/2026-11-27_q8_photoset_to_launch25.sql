-- 27.11.2026: Audi Q8 photo set (171 finals, car-photo-set skill) uploaded via cd-publish without a launch.
-- Attach them to raffle #25 "Audi Q8" in the HQ media library. Idempotent; fails if #25 is not exactly one launch.
DO $$
DECLARE v_launch uuid; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.launches WHERE cycle_no = 25 AND name ILIKE '%Q8%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'expected exactly one launch #25 Audi Q8, found %', v_n; END IF;
  SELECT id INTO v_launch FROM public.launches WHERE cycle_no = 25 AND name ILIKE '%Q8%';
  UPDATE public.creatives SET launch_id = v_launch
   WHERE 'audiq8-photoset' = ANY(tags) AND launch_id IS DISTINCT FROM v_launch;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'attached % creatives to launch #25', v_n;
END $$;
