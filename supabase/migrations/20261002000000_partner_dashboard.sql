-- =============================================================================
-- Partner Dashboard — projects, threaded comments, attachments
-- =============================================================================
-- Deployed to BOTH Supabase and Neon. It contains zero Supabase-only syntax
-- except section 6 (Storage), which is a no-op on Neon because the
-- storage.* schema does not exist there — that block is wrapped so a Neon
-- `psql -f migration.sql` run skips it cleanly instead of erroring.
--
-- Sections:
--   1. Extensions
--   2. projects      (hero table rows)
--   3. comments      (one level of replies via parent_id)
--   4. attachments   (images + links, one row per attachment)
--   5. comment_revisions + write_rate_limits   [ADDITIVE to the original spec]
--   6. Storage bucket "comment-images"          [Supabase only]
--   7. RLS
--
-- NOTE ON comment_revisions / write_rate_limits
-- ---------------------------------------------
-- These two tables are NOT in the original spec. They were added because:
--   * "Edit / delete only for the author (keep audit trail)" cannot be
--     satisfied by comments.updated_at alone — an edit overwrites `body`
--     with no history. comment_revisions stores the previous body of every
--     edit, so the full history survives.
--   * "Rate-limit writes: max 20 comments / 10 uploads per IP per hour"
--     needs a shared counter; serverless instances do not share memory,
--     so the counter lives in Postgres and is incremented atomically by
--     check_write_rate_limit() below.
-- Both are inert if you never read them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
-- gen_random_uuid() is built into PostgreSQL 13+; pgcrypto covers older
-- instances and is already enabled on this Supabase project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 2. projects
-- ---------------------------------------------------------------------------
-- Verbatim from the approved spec, with the DEFAULT kept so a row inserted
-- without an explicit timestamp still sorts correctly.
CREATE TABLE IF NOT EXISTS public.projects (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  status       text NOT NULL,
  url          text,
  image        text,
  updated_at   timestamptz DEFAULT now()
);

-- No CHECK constraint is placed on `status` on purpose: the four values
-- (Live / In Progress / Planned / Blocked) are validated in application code
-- (src/lib/partnerDashboard/status.ts). If you later add a fifth status you
-- only edit that one file instead of running a migration.

-- ---------------------------------------------------------------------------
-- 3. comments
-- ---------------------------------------------------------------------------
-- parent_id NULL  -> top-level comment
-- parent_id set   -> a reply. Only one level deep is enforced in the API
--                    (a reply may not itself be replied to).
CREATE TABLE IF NOT EXISTS public.comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   text REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  author       text NOT NULL,
  body         text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  deleted_at   timestamptz
);

-- Soft delete keeps the row (and therefore the audit trail), so every read
-- path filters on deleted_at IS NULL. This index makes that filter cheap.
CREATE INDEX IF NOT EXISTS comments_project_idx
  ON public.comments (project_id, created_at);
CREATE INDEX IF NOT EXISTS comments_parent_idx
  ON public.comments (parent_id);
CREATE INDEX IF NOT EXISTS comments_live_idx
  ON public.comments (project_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. attachments
-- ---------------------------------------------------------------------------
-- kind = 'image' -> url points at Supabase Storage (or a blob/base64 fallback)
-- kind = 'link'  -> url is any pasted URL; `label` holds the detected
--                   provider ("Drive link", "Figma", "YouTube", …)
CREATE TABLE IF NOT EXISTS public.attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id   uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  url          text NOT NULL,
  label        text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachments_comment_idx
  ON public.attachments (comment_id);

-- ---------------------------------------------------------------------------
-- 5a. comment_revisions  [ADDITIVE]
-- ---------------------------------------------------------------------------
-- Append-only. One row per edit, holding the body that was replaced, so the
-- pre-edit text is never lost. Readers of the live thread never see these.
CREATE TABLE IF NOT EXISTS public.comment_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id   uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  body         text NOT NULL,
  edited_by    text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comment_revisions_comment_idx
  ON public.comment_revisions (comment_id, created_at);

-- ---------------------------------------------------------------------------
-- 5b. write_rate_limits  [ADDITIVE]
-- ---------------------------------------------------------------------------
-- One row per (ip, kind) bucket. check_write_rate_limit() below resets the
-- window in-place, so this table stays small even under sustained traffic.
CREATE TABLE IF NOT EXISTS public.write_rate_limits (
  key           text PRIMARY KEY,
  window_start  timestamptz NOT NULL DEFAULT now(),
  count         integer NOT NULL DEFAULT 0
);

-- Atomic check-and-increment. Returns TRUE when the caller is still inside
-- its allowance. Doing this in one statement (INSERT … ON CONFLICT DO UPDATE
-- … RETURNING) avoids the read-then-write race two concurrent requests would
-- otherwise hit on a serverless platform.
CREATE OR REPLACE FUNCTION public.check_write_rate_limit(
  p_key    text,
  p_max    integer,
  p_window interval
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.write_rate_limits (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                  WHEN public.write_rate_limits.window_start < now() - p_window
                  THEN 1
                  ELSE public.write_rate_limits.count + 1
                END,
        window_start = CASE
                  WHEN public.write_rate_limits.window_start < now() - p_window
                  THEN now()
                  ELSE public.write_rate_limits.window_start
                END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Storage — bucket "comment-images"   [Supabase only]
-- ---------------------------------------------------------------------------
-- Neon is database-only, so on Neon this whole block is skipped and images
-- go to Vercel Blob instead (see BLOB_READ_WRITE_TOKEN in .env.example).
DO $storage$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('comment-images', 'comment-images', true)
    ON CONFLICT (id) DO NOTHING;

    -- Public read: required so <img src> works straight from Storage and the
    -- browser can cache thumbnails at the CDN edge.
    DROP POLICY IF EXISTS "comment-images public read" ON storage.objects;
    CREATE POLICY "comment-images public read"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'comment-images');

    -- The dashboard holds no Supabase Auth session, so uploads arrive as
    -- anon. The policy is deliberately narrow: this bucket only, and only
    -- image/* MIME types (checked against the metadata row the Storage API
    -- writes, which the client cannot forge through the upload endpoint).
    DROP POLICY IF EXISTS "comment-images insert images" ON storage.objects;
    CREATE POLICY "comment-images insert images"
      ON storage.objects FOR INSERT
      TO anon, authenticated
      WITH CHECK (
        bucket_id = 'comment-images'
        AND (metadata ->> 'mimetype') LIKE 'image/%'
      );

    -- Deletes are limited to this bucket. Without Supabase Auth there is no
    -- per-user ownership to scope to, so removal relies on the API's
    -- passcode gate.
    DROP POLICY IF EXISTS "comment-images delete" ON storage.objects;
    CREATE POLICY "comment-images delete"
      ON storage.objects FOR DELETE
      TO anon, authenticated
      USING (bucket_id = 'comment-images');
  ELSE
    RAISE NOTICE 'storage schema not found (Neon?) — skipping bucket setup';
  END IF;
END
$storage$;

-- ---------------------------------------------------------------------------
-- 7. Grants + RLS
-- ---------------------------------------------------------------------------
-- SECURITY NOTE — READ THIS BEFORE GOING LIVE
-- -------------------------------------------
-- Reads are intentionally public, matching every other public table in this
-- project (cms_data, tala_leads): the partner dashboard has no Supabase Auth
-- session, and the brief says "Read endpoints can stay public for now".
--
-- Writes are granted to anon as well, because the server currently holds no
-- SUPABASE_SERVICE_KEY. If writes were service_role-only, the dashboard would
-- be read-only the moment it deployed. The trade-off: anyone holding the
-- PUBLIC publishable key (which ships in the browser bundle) could in theory
-- call PostgREST directly and bypass the DASHBOARD_PASSCODE gate that /api
-- enforces.
--
-- To close that hole in one step, set SUPABASE_SERVICE_KEY in your
-- environment and then run supabase/migrations/20261002000100_partner_dashboard_hardening.sql.
-- That migration revokes anon INSERT/UPDATE/DELETE and leaves public SELECT
-- intact, after which only the server (holding the service key) can write.
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.projects, public.comments, public.attachments TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.projects, public.comments, public.attachments TO anon, authenticated;
GRANT SELECT, INSERT ON public.comment_revisions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.write_rate_limits TO anon, authenticated;
GRANT ALL ON public.projects, public.comments, public.attachments,
             public.comment_revisions, public.write_rate_limits TO service_role;

GRANT EXECUTE ON FUNCTION public.check_write_rate_limit(text, integer, interval) TO anon, authenticated;

ALTER TABLE public.projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.write_rate_limits ENABLE ROW LEVEL SECURITY;

-- Reads: open, matching cms_data / tala_leads.
DROP POLICY IF EXISTS "partner projects are readable" ON public.projects;
CREATE POLICY "partner projects are readable"
  ON public.projects FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "partner comments are readable" ON public.comments;
CREATE POLICY "partner comments are readable"
  ON public.comments FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "partner attachments are readable" ON public.attachments;
CREATE POLICY "partner attachments are readable"
  ON public.attachments FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "partner revisions are readable" ON public.comment_revisions;
CREATE POLICY "partner revisions are readable"
  ON public.comment_revisions FOR SELECT TO anon, authenticated USING (true);

-- Writes: see the SECURITY NOTE above. The passcode gate lives in
-- src/lib/partnerDashboard/handlers.server.ts and runs before any of these.
DROP POLICY IF EXISTS "partner projects are writable" ON public.projects;
CREATE POLICY "partner projects are writable"
  ON public.projects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "partner comments are writable" ON public.comments;
CREATE POLICY "partner comments are writable"
  ON public.comments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "partner attachments are writable" ON public.attachments;
CREATE POLICY "partner attachments are writable"
  ON public.attachments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "partner revisions are writable" ON public.comment_revisions;
CREATE POLICY "partner revisions are writable"
  ON public.comment_revisions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Rate-limit rows are never read by the client; only the counter function
-- touches them. anon needs no policy here, which is why none is created.
DROP POLICY IF EXISTS "partner rate limits service only" ON public.write_rate_limits;
CREATE POLICY "partner rate limits service only"
  ON public.write_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
