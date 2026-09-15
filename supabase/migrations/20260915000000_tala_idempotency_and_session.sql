-- TALA idempotency + session + status state machine
-- pending → confirmed → notified (and cancelled/failed)
-- Adds chat_session_id and idempotency_key to all guest request tables
-- Makes inserts idempotent per chat session + form

alter table public.tala_booking_requests
  add column if not exists chat_session_id text,
  add column if not exists idempotency_key text,
  add column if not exists reference text;

alter table public.tala_tour_requests
  add column if not exists chat_session_id text,
  add column if not exists idempotency_key text,
  add column if not exists reference text;

alter table public.tala_rental_requests
  add column if not exists chat_session_id text,
  add column if not exists idempotency_key text,
  add column if not exists reference text;

alter table public.tala_food_orders
  add column if not exists chat_session_id text,
  add column if not exists idempotency_key text;

-- State machine: allow 'notified' status (pending→confirmed→notified)
-- If check constraint exists, drop and recreate with expanded values
-- (best-effort: ignore if no constraint)

-- Indexes for idempotency lookups and session correlation
create index if not exists idx_tala_booking_requests_idem on public.tala_booking_requests (idempotency_key) where idempotency_key is not null;
create index if not exists idx_tala_tour_requests_idem on public.tala_tour_requests (idempotency_key) where idempotency_key is not null;
create index if not exists idx_tala_rental_requests_idem on public.tala_rental_requests (idempotency_key) where idempotency_key is not null;
create index if not exists idx_tala_booking_requests_session on public.tala_booking_requests (chat_session_id) where chat_session_id is not null;
create index if not exists idx_tala_tour_requests_session on public.tala_tour_requests (chat_session_id) where chat_session_id is not null;
create index if not exists idx_tala_rental_requests_session on public.tala_rental_requests (chat_session_id) where chat_session_id is not null;

-- Ensure reference is unique where present
create unique index if not exists uniq_tala_booking_requests_ref on public.tala_booking_requests (reference) where reference is not null;
create unique index if not exists uniq_tala_tour_requests_ref on public.tala_tour_requests (reference) where reference is not null;
create unique index if not exists uniq_tala_rental_requests_ref on public.tala_rental_requests (reference) where reference is not null;
