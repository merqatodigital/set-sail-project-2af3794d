-- =============================================================================
-- Partner Dashboard — WRITE HARDENING (opt-in, run AFTER setting the service key)
-- =============================================================================
-- Run this ONLY once SUPABASE_SERVICE_KEY is set in your environment.
--
-- Why it exists
-- -------------
-- 20261002000000_partner_dashboard.sql has to grant INSERT/UPDATE/DELETE to
-- anon, because the server starts out with no service key and the dashboard
-- would otherwise be read-only. But the publishable (anon) key is public — it
-- ships inside the browser bundle — so while those grants exist, a determined
-- person could talk to PostgREST directly and skip the DASHBOARD_PASSCODE gate
-- that /api enforces.
--
-- After this migration:
--   * anon can still SELECT (the brief: "read endpoints can stay public")
--   * anon can NO LONGER write
--   * the server, authenticating with SUPABASE_SERVICE_KEY, is the only writer
--   * the passcode gate in /api is therefore the single, unbypassable door
--
-- Apply with either:
--   psql "$NEON_DATABASE_URL" -f supabase/migrations/20261002000100_partner_dashboard_hardening.sql
-- or paste into the Supabase SQL Editor.
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON public.projects          FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comments          FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attachments       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comment_revisions FROM anon, authenticated;
REVOKE INSERT, UPDATE          ON public.write_rate_limits FROM anon, authenticated;

-- Replace the wide-open write policies with service-role-only ones.
DROP POLICY IF EXISTS "partner projects are writable"    ON public.projects;
DROP POLICY IF EXISTS "partner comments are writable"    ON public.comments;
DROP POLICY IF EXISTS "partner attachments are writable" ON public.attachments;
DROP POLICY IF EXISTS "partner revisions are writable"   ON public.comment_revisions;

CREATE POLICY "partner projects service writes"
  ON public.projects FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "partner comments service writes"
  ON public.comments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "partner attachments service writes"
  ON public.attachments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "partner revisions service writes"
  ON public.comment_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Storage uploads must move to the server too, so the client no longer needs
-- an INSERT policy on the bucket. Comment this pair out if you want to keep
-- uploading directly from the browser with the publishable key.
DROP POLICY IF EXISTS "comment-images insert images" ON storage.objects;
DROP POLICY IF EXISTS "comment-images delete"        ON storage.objects;

CREATE POLICY "comment-images service writes"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'comment-images')
  WITH CHECK (bucket_id = 'comment-images');

-- Rate-limit counters stay server-only in both migrations.
DROP POLICY IF EXISTS "partner rate limits service only" ON public.write_rate_limits;
CREATE POLICY "partner rate limits service only"
  ON public.write_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
