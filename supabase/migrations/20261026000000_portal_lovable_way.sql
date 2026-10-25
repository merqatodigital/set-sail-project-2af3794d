-- ===========================================================================
-- GUEST PORTAL, THE LOVABLE WAY — paste this whole file once, Run, done.
-- ===========================================================================
-- Why: this Supabase project is Lovable-managed, so the service-role key
-- cannot be obtained and no code may depend on it. This file makes the
-- Guest Portal work with ONLY the publishable (anon) key:
--
--   1. Ensures the portal tables/columns exist (idempotent — safe even if
--      earlier portal migrations were already run by Lovable).
--   2. anon may INSERT guest requests (rentals, tours, bookings, food,
--      messages) — submissions only, never reads of private rows.
--   3. anon may SELECT the public catalog (active motorbikes / tours) so
--      the portal can list real bikes and tours from the ops tables.
--   4. portal_guest_records(phone) — a SECURITY DEFINER function that
--      returns ONLY that guest's rows (bookings, tours, rentals, food,
--      messages, folio). This replaces the service-role read path.
--
-- After running: no other SQL is needed for the portal. In Lovable, make
-- sure OPENROUTER_API_KEY exists in Secrets (it signs portal sessions if
-- PORTAL_SESSION_SECRET is not set — either works).
-- ===========================================================================

-- --- Phone normalisation (digits, leading 0 -> 63) -------------------------
CREATE OR REPLACE FUNCTION public.portal_normalize_phone(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') LIKE '0%'
      THEN '63' || substr(regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'), 2)
    ELSE regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g')
  END;
$$;

-- --- Guest request tables (exist since 20260729; create-if-missing) --------
CREATE TABLE IF NOT EXISTS public.tala_booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name TEXT NOT NULL DEFAULT '', room_type TEXT NOT NULL DEFAULT '',
  check_in TEXT NOT NULL DEFAULT '', check_out TEXT NOT NULL DEFAULT '',
  guests INTEGER NOT NULL DEFAULT 1, amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'tala_chat', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.tala_tour_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name TEXT NOT NULL DEFAULT '', guest_phone TEXT NOT NULL DEFAULT '',
  tour_name TEXT NOT NULL DEFAULT '', tour_date TEXT NOT NULL DEFAULT '',
  guests INTEGER NOT NULL DEFAULT 1, amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'requested',
  source TEXT NOT NULL DEFAULT 'tala_chat', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.tala_rental_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name TEXT NOT NULL DEFAULT '', guest_phone TEXT NOT NULL DEFAULT '',
  bike_name TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',
  source TEXT NOT NULL DEFAULT 'tala_chat', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.tala_food_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL DEFAULT '', guest_name TEXT NOT NULL DEFAULT '',
  guest_phone TEXT NOT NULL DEFAULT '', items JSONB NOT NULL DEFAULT '[]',
  total NUMERIC NOT NULL DEFAULT 0, total_cost NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'portal', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ, preparing_at TIMESTAMPTZ, ready_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  paid_amount NUMERIC NOT NULL DEFAULT 0, paid_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.tala_guest_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name TEXT NOT NULL DEFAULT '', guest_phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '', reply TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unread', source TEXT NOT NULL DEFAULT 'portal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), replied_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.tala_folio_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name TEXT NOT NULL DEFAULT '', guest_phone TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'charge', category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT '', amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'cash', reference TEXT NOT NULL DEFAULT '',
  related_type TEXT NOT NULL DEFAULT '', related_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --- Columns the portal code writes (from the 20260810 / 20260915 files) ---
ALTER TABLE public.tala_booking_requests
  ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chat_session_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.tala_tour_requests
  ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chat_session_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.tala_rental_requests
  ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chat_session_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.tala_food_orders
  ADD COLUMN IF NOT EXISTS chat_session_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- --- Public catalog tables (admin-managed; create-if-missing) --------------
CREATE TABLE IF NOT EXISTS public.motorbikes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', plate TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '', daily_rate NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true, status TEXT NOT NULL DEFAULT 'available',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.tours_catalog (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '', price NUMERIC NOT NULL DEFAULT 0,
  capacity INT NOT NULL DEFAULT 1, inclusions TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true, sort_order INT NOT NULL DEFAULT 0
);

-- --- Grants + RLS ----------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  -- Guest submissions: anon INSERT only (requests must start unconfirmed).
  FOREACH t IN ARRAY ARRAY['tala_booking_requests','tala_tour_requests','tala_rental_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT INSERT ON public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass
                   AND polname = 'portal anon submit ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK (status IN (''pending'', ''requested''))',
                     'portal anon submit ' || t, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass
                   AND polname = 'portal auth manage ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
                     'portal auth manage ' || t, t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['tala_food_orders','tala_guest_messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT INSERT ON public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass
                   AND polname = 'portal anon submit ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)',
                     'portal anon submit ' || t, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass
                   AND polname = 'portal auth manage ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
                     'portal auth manage ' || t, t);
    END IF;
  END LOOP;

  -- Folio lines are owner-written; guests only receive them via the RPC.
  EXECUTE 'ALTER TABLE public.tala_folio_lines ENABLE ROW LEVEL SECURITY';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.tala_folio_lines TO authenticated';
  EXECUTE 'GRANT ALL ON public.tala_folio_lines TO service_role';
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tala_folio_lines'::regclass
                 AND polname = 'portal auth manage tala_folio_lines') THEN
    EXECUTE 'CREATE POLICY "portal auth manage tala_folio_lines" ON public.tala_folio_lines
             FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;

  -- Public catalog: anyone may read ACTIVE bikes/tours (names + rates only
  -- by table design); only authenticated (admin) may change them.
  FOREACH t IN ARRAY ARRAY['motorbikes','tours_catalog'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass
                   AND polname = 'portal public catalog ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (active = true)',
                     'portal public catalog ' || t, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass
                   AND polname = 'portal auth manage ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
                     'portal auth manage ' || t, t);
    END IF;
  END LOOP;
END $$;

-- --- The records function (replaces the service-role read path) ------------
CREATE OR REPLACE FUNCTION public.portal_guest_records(p_phone TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'bookings', COALESCE((SELECT jsonb_agg(b ORDER BY b.created_at DESC)
      FROM public.tala_booking_requests b
      WHERE public.portal_normalize_phone(b.guest_phone) = public.portal_normalize_phone(p_phone)), '[]'::jsonb),
    'tours', COALESCE((SELECT jsonb_agg(t ORDER BY t.created_at DESC)
      FROM public.tala_tour_requests t
      WHERE public.portal_normalize_phone(t.guest_phone) = public.portal_normalize_phone(p_phone)), '[]'::jsonb),
    'rentals', COALESCE((SELECT jsonb_agg(r ORDER BY r.created_at DESC)
      FROM public.tala_rental_requests r
      WHERE public.portal_normalize_phone(r.guest_phone) = public.portal_normalize_phone(p_phone)), '[]'::jsonb),
    'foodOrders', COALESCE((SELECT jsonb_agg(f ORDER BY f.created_at DESC)
      FROM public.tala_food_orders f
      WHERE public.portal_normalize_phone(f.guest_phone) = public.portal_normalize_phone(p_phone)), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(m ORDER BY m.created_at DESC)
      FROM public.tala_guest_messages m
      WHERE public.portal_normalize_phone(m.guest_phone) = public.portal_normalize_phone(p_phone)), '[]'::jsonb),
    'folioLines', COALESCE((SELECT jsonb_agg(l ORDER BY l.created_at ASC)
      FROM public.tala_folio_lines l
      WHERE public.portal_normalize_phone(l.guest_phone) = public.portal_normalize_phone(p_phone)), '[]'::jsonb)
  );
$$;
GRANT EXECUTE ON FUNCTION public.portal_guest_records(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_normalize_phone(TEXT) TO anon, authenticated;

-- --- Verify (optional, run separately) --------------------------------------
-- select public.portal_guest_records('0917 123 4567');       -- expect JSON with 6 arrays
-- select has_table_privilege('anon','public.motorbikes','SELECT');          -- expect: true
-- select has_table_privilege('anon','public.tala_rental_requests','INSERT'); -- expect: true
-- select has_table_privilege('anon','public.tala_rental_requests','SELECT'); -- expect: false
