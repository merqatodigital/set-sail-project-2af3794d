// Guest-state reads/writes for TallaAgent — the SAME persistent Supabase truth
// the Guest Portal uses. Reuses the exact Supabase REST pattern from
// db/operations.ts (server-side service-role key). Single-resort scope preserved
// via KNOWN_RESORT, consistent with operations.ts. Guest matching is by
// guest_name/guest_phone (the operational tables carry those columns).
//
// FINAL OpenCode contract (e771f3f): messages -> tala_guest_messages, food ->
// tala_food_orders. Folio -> tala_folio_lines with explicit related_type/related_id
// (no name-search, no fuzzy guess).

import type { Env } from "../../env.js";

function supabaseBase(env: Env): string {
  const raw = env.SUPABASE_URL ? env.SUPABASE_URL.replace(/^["']|["']$/g, "").trim() : "";
  return raw.replace(/\/$/, "");
}
function supabaseKey(env: Env): string {
  const raw = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return raw ? raw.replace(/^["']|["']$/g, "").trim() : "";
}

async function sbSelect(
  env: Env,
  table: string,
  select: string,
  filters: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) throw new Error("Supabase not configured");
  const url = new URL(`${base}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Supabase ${table} read failed (HTTP ${res.status})`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

function guestOrFilter(name?: string, phone?: string): Record<string, string> {
  const parts: string[] = [];
  if (name) parts.push(`guest_name=eq.${name}`);
  if (phone) parts.push(`guest_phone=eq.${phone}`);
  return { or: `(${parts.join(",")})` };
}

// ---------------------------------------------------------------------------
// ROOM / STAY — Supabase `bookings`
// ---------------------------------------------------------------------------
export interface GuestStay {
  id: string;
  reference: string;
  roomType: string;
  guests: number;
  checkIn: string;
  checkOut: string;
  status: string;
  amount: number;
  paidAmount: number;
  notes: string;
}
export async function getGuestStay(
  env: Env,
  opts: { name?: string; phone?: string },
): Promise<GuestStay[]> {
  if (!opts.name && !opts.phone) return [];
  const rows = await sbSelect(
    env,
    "bookings",
    "id,reference,guest_name,room_type,guests,check_in,check_out,status,amount,paid_amount,notes",
    { ...guestOrFilter(opts.name, opts.phone), order: "check_in.asc" },
  ).catch(() => []);
  return rows.map((r) => ({
    id: String(r.id),
    reference: String(r.reference ?? ""),
    roomType: String(r.room_type ?? ""),
    guests: Number(r.guests ?? 1),
    checkIn: String(r.check_in ?? ""),
    checkOut: String(r.check_out ?? ""),
    status: String(r.status ?? "pending"),
    amount: Number(r.amount ?? 0),
    paidAmount: Number(r.paid_amount ?? 0),
    notes: String(r.notes ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// TOURS — Supabase `tala_tour_requests` (transaction). Catalog = D1 tours_catalog.
// ---------------------------------------------------------------------------
export interface GuestTourRequest {
  id: string;
  tourName: string;
  tourDate: string;
  guests: number;
  amount: number;
  notes: string;
  status: string;
  source: string;
  createdAt: string;
}
export async function getGuestTourRequests(
  env: Env,
  opts: { name?: string; phone?: string },
): Promise<GuestTourRequest[]> {
  if (!opts.name && !opts.phone) return [];
  const rows = await sbSelect(
    env,
    "tala_tour_requests",
    "id,guest_name,guest_phone,tour_name,tour_date,guests,amount,notes,status,source,created_at",
    { ...guestOrFilter(opts.name, opts.phone), order: "tour_date.asc" },
  ).catch(() => []);
  return rows.map((r) => ({
    id: String(r.id),
    tourName: String(r.tour_name ?? ""),
    tourDate: String(r.tour_date ?? ""),
    guests: Number(r.guests ?? 1),
    amount: Number(r.amount ?? 0),
    notes: String(r.notes ?? ""),
    status: String(r.status ?? "requested"),
    source: String(r.source ?? "tala_chat"),
    createdAt: String(r.created_at ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// MOTORBIKES — request (tala_rental_requests) + active (motorbike_rentals) + rate (motorbikes)
// ---------------------------------------------------------------------------
export interface GuestMotorbikeState {
  id: string;
  source: "request" | "rental";
  bikeName: string;
  bikeLabel: string;
  ratePerDay: number;
  startDate: string;
  endDate: string;
  status: string;
  guestPhone: string;
}
export async function getGuestMotorbikeState(
  env: Env,
  opts: { name?: string; phone?: string },
): Promise<GuestMotorbikeState[]> {
  if (!opts.name && !opts.phone) return [];
  const out: GuestMotorbikeState[] = [];

  const reqs = await sbSelect(
    env,
    "tala_rental_requests",
    "id,guest_name,guest_phone,bike_name,start_date,end_date,status,source",
    { ...guestOrFilter(opts.name, opts.phone), order: "start_date.asc" },
  ).catch(() => []);
  for (const r of reqs) {
    out.push({
      id: String(r.id),
      source: "request",
      bikeName: String(r.bike_name ?? ""),
      bikeLabel: String(r.bike_name ?? ""),
      ratePerDay: 0,
      startDate: String(r.start_date ?? ""),
      endDate: String(r.end_date ?? ""),
      status: String(r.status ?? "requested"),
      guestPhone: String(r.guest_phone ?? ""),
    });
  }

  const rentals = await sbSelect(
    env,
    "motorbike_rentals",
    "id,bike_id,guest_name,guest_phone,start_date,end_date,status",
    { ...guestOrFilter(opts.name, opts.phone), order: "start_date.asc" },
  ).catch(() => []);
  for (const r of rentals) {
    const bikeId = String(r.bike_id ?? "");
    const bike = await sbSelect(
      env,
      "motorbikes",
      "name,daily_rate",
      { id: `eq.${bikeId}` },
    ).catch(() => [] as Array<Record<string, unknown>>);
    const b = bike[0] ?? {};
    out.push({
      id: String(r.id),
      source: "rental",
      bikeName: String(b.name ?? bikeId),
      bikeLabel: String(b.name ?? bikeId),
      ratePerDay: Number(b.daily_rate ?? 0),
      startDate: String(r.start_date ?? ""),
      endDate: String(r.end_date ?? ""),
      status: String(r.status ?? "active"),
      guestPhone: String(r.guest_phone ?? ""),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// FOOD — Supabase `tala_food_orders` (authoritative guest transaction source)
// ---------------------------------------------------------------------------
export interface GuestFoodOrder {
  id: string;
  reference: string;
  items: unknown[];
  total: number;
  status: string;
  notes: string;
  confirmedAt: string;
  preparingAt: string;
  readyAt: string;
  deliveredAt: string;
  cancelledAt: string;
  paidAmount: number;
  paidAt: string;
}
export async function getGuestFoodOrders(
  env: Env,
  opts: { name?: string; phone?: string },
): Promise<GuestFoodOrder[]> {
  if (!opts.name && !opts.phone) return [];
  const rows = await sbSelect(
    env,
    "tala_food_orders",
    "id,reference,guest_name,guest_phone,items,total,status,notes,confirmed_at,preparing_at,ready_at,delivered_at,cancelled_at,paid_amount,paid_at",
    { ...guestOrFilter(opts.name, opts.phone), order: "created_at.asc" },
  ).catch(() => []);
  return rows.map((r) => ({
    id: String(r.id),
    reference: String(r.reference ?? ""),
    items: Array.isArray(r.items) ? (r.items as unknown[]) : [],
    total: Number(r.total ?? 0),
    status: String(r.status ?? "pending"),
    notes: String(r.notes ?? ""),
    confirmedAt: String(r.confirmed_at ?? ""),
    preparingAt: String(r.preparing_at ?? ""),
    readyAt: String(r.ready_at ?? ""),
    deliveredAt: String(r.delivered_at ?? ""),
    cancelledAt: String(r.cancelled_at ?? ""),
    paidAmount: Number(r.paid_amount ?? 0),
    paidAt: String(r.paid_at ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// MESSAGES — Supabase `tala_guest_messages` (Portal inbox source)
// ---------------------------------------------------------------------------
export interface GuestMessage {
  id: string;
  message: string;
  reply: string;
  status: string;
  source: string;
  createdAt: string;
  repliedAt: string;
}
export async function getGuestMessages(
  env: Env,
  opts: { name?: string; phone?: string },
): Promise<GuestMessage[]> {
  if (!opts.name && !opts.phone) return [];
  const rows = await sbSelect(
    env,
    "tala_guest_messages",
    "id,guest_name,guest_phone,message,reply,status,source,created_at,replied_at",
    { ...guestOrFilter(opts.name, opts.phone), order: "created_at.desc" },
  ).catch(() => []);
  return rows.map((r) => ({
    id: String(r.id),
    message: String(r.message ?? ""),
    reply: String(r.reply ?? ""),
    status: String(r.status ?? "unread"),
    source: String(r.source ?? "portal"),
    createdAt: String(r.created_at ?? ""),
    repliedAt: String(r.replied_at ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// FOLIO — Supabase `tala_folio_lines` with EXPLICIT related_type/related_id
// (no name-search, no fuzzy guess; unresolved rows reported separately)
// ---------------------------------------------------------------------------
export interface FolioLine {
  kind: "charge" | "payment";
  category: string;
  description: string;
  amount: number;
  method: string;
  reference: string;
  relatedType: string;
  relatedId: string;
}
export interface GuestFolio {
  guestName: string;
  lines: FolioLine[];
  totalCharges: number;
  totalPaid: number;
  balance: number;
  unresolved: Array<{ id: string; note: string }>;
}
export async function getGuestFolio(
  env: Env,
  opts: { name?: string; phone?: string },
): Promise<GuestFolio> {
  if (!opts.name && !opts.phone) {
    return { guestName: "", lines: [], totalCharges: 0, totalPaid: 0, balance: 0, unresolved: [] };
  }
  // Folio lines are linked by guest_name/guest_phone explicitly (no text search).
  const rows = await sbSelect(
    env,
    "tala_folio_lines",
    "id,kind,category,description,amount,method,reference,related_type,related_id,guest_name,guest_phone",
    { ...guestOrFilter(opts.name, opts.phone), order: "created_at.asc" },
  ).catch(() => []);
  const lines: FolioLine[] = [];
  const unresolved: Array<{ id: string; note: string }> = [];
  for (const r of rows) {
    const kind = String(r.kind ?? "charge");
    const relatedType = String(r.related_type ?? "");
    const relatedId = String(r.related_id ?? "");
    if ((kind === "charge" || kind === "payment") && !relatedType && !relatedId) {
      // No explicit link — report as unresolved instead of guessing.
      unresolved.push({ id: String(r.id), note: "folio line without related_type/related_id" });
    }
    lines.push({
      kind: kind === "payment" ? "payment" : "charge",
      category: String(r.category ?? "other"),
      description: String(r.description ?? ""),
      amount: Number(r.amount ?? 0),
      method: String(r.method ?? "cash"),
      reference: String(r.reference ?? ""),
      relatedType,
      relatedId,
    });
  }
  const totalCharges = lines
    .filter((l) => l.kind === "charge")
    .reduce((s, l) => s + l.amount, 0);
  const totalPaid = lines
    .filter((l) => l.kind === "payment")
    .reduce((s, l) => s + Math.abs(l.amount), 0);
  return {
    guestName: opts.name ?? "",
    lines,
    totalCharges,
    totalPaid,
    balance: totalCharges - totalPaid,
    unresolved,
  };
}

// ---------------------------------------------------------------------------
// WRITE — persist a TALA operational message into `tala_guest_messages`
// ---------------------------------------------------------------------------
export interface WriteGuestMessageInput {
  guestName: string;
  guestPhone: string;
  message: string;
  reply?: string;
  status?: string;
  source?: string;
}
export async function writeGuestMessage(
  env: Env,
  input: WriteGuestMessageInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) return { ok: false, error: "Supabase not configured" };
  // NOTE: tala_guest_messages.id is UUID with DEFAULT gen_random_uuid(), so we
  // must NOT send a text id (it would fail with "invalid input syntax for type
  // uuid"). Omit id and let Postgres generate it; read the real UUID back.
  const res = await fetch(`${base}/rest/v1/tala_guest_messages`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      guest_name: input.guestName,
      guest_phone: input.guestPhone,
      message: input.message,
      reply: input.reply ?? "",
      status: input.status ?? "unread",
      source: input.source ?? "tala_chat",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Message persist failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
  }
  let id: string | undefined;
  try {
    const rows = (await res.json()) as Array<{ id?: string }>;
    id = rows[0]?.id;
  } catch {
    /* ignore parse */
  }
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// BOOKING REQUEST — deterministic room-booking creation into tala_booking_requests
// with explicit contact persistence + short human reference + duplicate guard.
// ---------------------------------------------------------------------------
export interface CreateBookingRequestInput {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  notes?: string;
}
export interface BookingRequestResult {
  id: string;
  reference: string;
}

function makeReference(checkIn: string): string {
  // MT-YYYYMMDD-XXXX — short, human-readable; UUID stays the PK internally.
  const ymd = (checkIn || "").replace(/-/g, "").slice(0, 8) || "00000000";
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MT-${ymd}-${rand}`;
}

/** Find an existing PENDING booking for the same guest/room/dates/guests (dedupe). */
export async function findPendingBooking(
  env: Env,
  opts: { guestName: string; roomType: string; checkIn: string; checkOut: string; guests: number },
): Promise<BookingRequestResult | null> {
  const rows = await sbSelect(
    env,
    "tala_booking_requests",
    "id,reference,guest_name,room_type,check_in,check_out,guests,status",
    {
      and: `(guest_name.eq.${opts.guestName},room_type.eq.${opts.roomType},check_in.eq.${opts.checkIn},check_out.eq.${opts.checkOut},guests.eq.${opts.guests},status.eq.pending)`,
    },
  ).catch(() => []);
  const r = rows[0];
  return r ? { id: String(r.id), reference: String(r.reference ?? "") } : null;
}

export async function createBookingRequest(
  env: Env,
  input: CreateBookingRequestInput,
): Promise<BookingRequestResult> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) throw new Error("Supabase not configured");
  // Do NOT generate an id — let Supabase DEFAULT gen_random_uuid() create the UUID PK.
  const reference = makeReference(input.checkIn);
  const res = await fetch(`${base}/rest/v1/tala_booking_requests`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      reference,
      guest_name: input.guestName,
      guest_email: input.guestEmail,
      guest_phone: input.guestPhone,
      room_type: input.roomType,
      check_in: input.checkIn,
      check_out: input.checkOut,
      guests: input.guests,
      notes: input.notes ?? "",
      status: "pending",
      source: "tala_chat",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Booking request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  // Read the server-generated UUID from the representation (never exposed to guest).
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const id = rows[0] ? String(rows[0].id) : "";
  return { id, reference };
}

// ---------------------------------------------------------------------------
// WORKSPACE DAY PASS — first-class bookable PRODUCT (not room inventory).
// Persisted in tala_booking_requests with room_type = "Workspace Day Pass" as
// the explicit product discriminator. It never consumes Superior/Standard/Basic
// room stock (checkRoomAvailability only matches real room types). The
// authoritative price is read from the worker's own D1 property_settings
// (key "dayPassPrice", category "financial") — the SAME store the Admin writes
// via /api/settings — never trusted from the guest message and never hardcoded.
// ---------------------------------------------------------------------------
export const DAY_PASS_ROOM_TYPE = "Workspace Day Pass";

/** Authoritative Day Pass price (PHP/guest/day) from D1 property_settings. */
export async function getDayPassPrice(
  env: Env,
  tenantId = "",
): Promise<number | null> {
  try {
    const db = (env as unknown as { DB?: import("@cloudflare/workers-types").D1Database }).DB;
    if (!db) return null;
    const { getSettingValue } = await import("./propertySettingsRepo.js");
    const raw = await getSettingValue(db, tenantId, "dayPassPrice").catch(() => null);
    const price = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export interface DayPassRequestInput {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  day: string; // ISO YYYY-MM-DD (single day)
  guests: number;
  arrivalTime?: string;
  notes?: string;
}

/** Dedupe: same guest/day/guests already pending as a Day Pass. */
export async function findPendingDayPass(
  env: Env,
  o: { guestName: string; day: string; guests: number },
): Promise<{ id: string; reference: string } | null> {
  const rows = await sbSelect(
    env,
    "tala_booking_requests",
    "id,reference",
    {
      and: `(room_type.eq.${DAY_PASS_ROOM_TYPE},guest_name.eq.${o.guestName},check_in.eq.${o.day},guests.eq.${o.guests},status.eq.pending)`,
    },
  ).catch(() => []);
  const r = rows[0];
  return r ? { id: String(r.id), reference: String(r.reference ?? "") } : null;
}

export async function createDayPassRequest(
  env: Env,
  input: DayPassRequestInput & { amount: number; reference: string },
): Promise<{ id: string; reference: string }> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) throw new Error("Supabase not configured");
  const reference = input.reference || makeRef("MT", input.day);
  const res = await fetch(`${base}/rest/v1/tala_booking_requests`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      reference,
      guest_name: input.guestName,
      guest_email: input.guestEmail,
      guest_phone: input.guestPhone,
      room_type: DAY_PASS_ROOM_TYPE,
      check_in: input.day,
      check_out: input.day, // single-day product
      guests: input.guests,
      amount: input.amount, // authoritative: price x guests, server-computed
      notes: input.notes ?? "",
      status: "pending",
      source: "tala_chat",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Day pass request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const id = rows[0] ? String(rows[0].id) : "";
  return { id, reference };
}

// ---------------------------------------------------------------------------
// ROOM AVAILABILITY — read-only conflict check against authoritative `bookings`.
// Returns real overlap data only; performs NO write and never invents capacity.
// ---------------------------------------------------------------------------
export type AvailabilityStatus = "available" | "unavailable" | "unknown";
export interface RoomAvailability {
  status: AvailabilityStatus;
  roomType: string;
  checkIn: string;
  checkOut: string;
  conflictingBookings: number;
  message: string;
}

export async function checkRoomAvailability(
  env: Env,
  opts: { roomType: string; checkIn: string; checkOut: string; guests?: number },
): Promise<RoomAvailability> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  const fallback = (msg: string): RoomAvailability => ({
    status: "unknown",
    roomType: opts.roomType,
    checkIn: opts.checkIn,
    checkOut: opts.checkOut,
    conflictingBookings: 0,
    message: msg,
  });
  if (!base || !key) return fallback("Availability service not configured.");
  try {
    const rows = await sbSelect(
      env,
      "bookings",
      "id,room_type,check_in,check_out,status,guests",
      {
        room_type: `eq.${opts.roomType}`,
        status: "in.(confirmed,checked_in)",
        and: `(check_in.lt.${opts.checkOut},check_out.gt.${opts.checkIn})`,
      },
    );
    const conflicts = rows.filter((r) => String(r.room_type) === opts.roomType).length;
    if (conflicts > 0) {
      return {
        status: "unavailable",
        roomType: opts.roomType,
        checkIn: opts.checkIn,
        checkOut: opts.checkOut,
        conflictingBookings: conflicts,
        message: `${opts.roomType} is not available for ${opts.checkIn} to ${opts.checkOut} (${conflicts} conflicting reservation(s)).`,
      };
    }
    return {
      status: "available",
      roomType: opts.roomType,
      checkIn: opts.checkIn,
      checkOut: opts.checkOut,
      conflictingBookings: 0,
      message: `No reservation conflicts for ${opts.roomType} ${opts.checkIn} to ${opts.checkOut}. We'll confirm capacity when you request the booking.`,
    };
  } catch {
    return fallback("Could not verify availability right now.");
  }
}

// ---------------------------------------------------------------------------
// AUTHORITATIVE PRICING LOOKUPS (guest/model prices are NEVER financial truth)
// ---------------------------------------------------------------------------
import { listActiveTours } from "./toursRepo.js";

/** Tour price from D1 tours_catalog. Returns null if the tour name is unknown. */
export async function getTourPrice(
  db: import("@cloudflare/workers-types").D1Database,
  tenantId: string,
  tourName: string,
): Promise<number | null> {
  const tours = await listActiveTours(db, tenantId).catch(() => []);
  const t = tours.find((x) => x.name.toLowerCase() === tourName.toLowerCase());
  return t ? Number(t.price ?? 0) : null;
}

/** Motorbike daily rate from Supabase `motorbikes` by name. Null if unknown. */
export async function getBikeRate(
  env: Env,
  bikeName: string,
): Promise<number | null> {
  const rows = await sbSelect(env, "motorbikes", "name,daily_rate", {
    name: `eq.${bikeName}`,
  }).catch(() => []);
  const b = rows[0];
  return b ? Number(b.daily_rate ?? 0) : null;
}

// ---------------------------------------------------------------------------
// WRITE — tour request (authoritative tala_tour_requests)
// ---------------------------------------------------------------------------
export interface TourRequestInput {
  guestName: string;
  guestPhone: string;
  guestEmail?: string;
  tourName: string;
  tourDate: string;
  guests: number;
  amount: number;
  notes?: string;
}
export interface LifecycleResult {
  id: string;
  reference: string;
}

function makeRef(prefix: string, anchor: string): string {
  const ymd = (anchor || "").replace(/-/g, "").slice(0, 8) || "00000000";
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${ymd}-${rand}`;
}

/** Dedupe: same guest/tour/date/guests already requested (pending/requested). */
export async function findPendingTour(
  env: Env,
  o: { guestName: string; tourName: string; tourDate: string; guests: number },
): Promise<LifecycleResult | null> {
  const rows = await sbSelect(
    env,
    "tala_tour_requests",
    "id,reference,guest_name,tour_name,tour_date,guests,status",
    {
      and: `(guest_name.eq.${o.guestName},tour_name.eq.${o.tourName},tour_date.eq.${o.tourDate},guests.eq.${o.guests},status.in.(requested,pending,confirmed))`,
    },
  ).catch(() => []);
  const r = rows[0];
  return r ? { id: String(r.id), reference: String(r.reference ?? "") } : null;
}

export async function createTourRequest(
  env: Env,
  input: TourRequestInput,
): Promise<LifecycleResult> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) throw new Error("Supabase not configured");
  const reference = makeRef("TT", input.tourDate);
  const res = await fetch(`${base}/rest/v1/tala_tour_requests`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      reference,
      guest_name: input.guestName,
      guest_phone: input.guestPhone,
      guest_email: input.guestEmail ?? "",
      tour_name: input.tourName,
      tour_date: input.tourDate,
      guests: input.guests,
      amount: input.amount,
      notes: input.notes ?? "",
      status: "requested",
      source: "tala_chat",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tour request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const id = rows[0] ? String(rows[0].id) : "";
  return { id, reference };
}

// ---------------------------------------------------------------------------
// WRITE — motorbike rental request (authoritative tala_rental_requests)
// ---------------------------------------------------------------------------
export interface RentalRequestInput {
  guestName: string;
  guestPhone: string;
  bikeName: string;
  startDate: string;
  endDate: string;
  notes?: string;
}
export async function findPendingRental(
  env: Env,
  o: { guestName: string; bikeName: string; startDate: string; endDate: string },
): Promise<LifecycleResult | null> {
  const rows = await sbSelect(
    env,
    "tala_rental_requests",
    "id,reference,guest_name,bike_name,start_date,end_date,status",
    {
      and: `(guest_name.eq.${o.guestName},bike_name.eq.${o.bikeName},start_date.eq.${o.startDate},end_date.eq.${o.endDate},status.in.(requested,pending,confirmed))`,
    },
  ).catch(() => []);
  const r = rows[0];
  return r ? { id: String(r.id), reference: String(r.reference ?? "") } : null;
}

export async function createRentalRequest(
  env: Env,
  input: RentalRequestInput,
): Promise<LifecycleResult> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) throw new Error("Supabase not configured");
  const reference = makeRef("MR", input.startDate);
  const res = await fetch(`${base}/rest/v1/tala_rental_requests`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      reference,
      guest_name: input.guestName,
      guest_phone: input.guestPhone,
      bike_name: input.bikeName,
      start_date: input.startDate,
      end_date: input.endDate,
      notes: input.notes ?? "",
      status: "requested",
      source: "tala_chat",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Rental request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const id = rows[0] ? String(rows[0].id) : "";
  return { id, reference };
}

// ---------------------------------------------------------------------------
// WRITE — housekeeping request (D1 guest_requests; no Supabase housekeeping table)
// Deterministic: validation + dedupe + short reference, status pending.
// ---------------------------------------------------------------------------
import { createGuestRequest } from "./guestRequestRepo.js";

export async function createHousekeepingRequest(
  db: import("@cloudflare/workers-types").D1Database,
  tenantId: string,
  input: { guestName: string; room: string; taskType: string; priority: string; notes?: string },
): Promise<LifecycleResult> {
  const reference = makeRef("HK", new Date().toISOString().slice(0, 10));
  // Reuse the existing D1 guest_requests row (housekeeping type) for persistence.
  const rec = await createGuestRequest(db, tenantId, {
    type: "housekeeping",
    guestName: input.guestName,
    roomType: input.room,
    notes: `task:${input.taskType}|priority:${input.priority}|${input.notes ?? ""}`,
    source: "tala_chat",
  });
  // Overwrite the auto-generated id reference by returning our short ref too.
  return { id: rec.id, reference };
}

// ---------------------------------------------------------------------------
// WRITE — record an explicit payment into tala_folio_lines (owner/admin only)
// ---------------------------------------------------------------------------
export interface PaymentInput {
  guestName: string;
  guestPhone: string;
  amount: number;
  method: string;
  reference?: string;
  relatedType?: string;
  relatedId?: string;
}
export async function recordPayment(
  env: Env,
  input: PaymentInput,
): Promise<LifecycleResult> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) throw new Error("Supabase not configured");
  const reference = input.reference || makeRef("PAY", new Date().toISOString().slice(0, 10));
  const res = await fetch(`${base}/rest/v1/tala_folio_lines`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      guest_name: input.guestName,
      guest_phone: input.guestPhone,
      kind: "payment",
      category: "payment",
      description: `Payment ${input.method}`,
      amount: input.amount,
      method: input.method,
      reference,
      related_type: input.relatedType ?? "",
      related_id: input.relatedId ?? "",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Payment record failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const id = rows[0] ? String(rows[0].id) : "";
  return { id, reference };
}

// ---------------------------------------------------------------------------
// CHECK-IN / CHECK-OUT (owner/admin authenticated flow on Supabase `bookings`)
// ---------------------------------------------------------------------------
export type StayPhase =
  | "before_arrival"
  | "checked_in"
  | "staying"
  | "checkout_approaching"
  | "checked_out";

export function computeStayPhase(checkIn: string, checkOut: string, status: string, now = new Date()): StayPhase {
  const ci = Date.parse(checkIn);
  const co = Date.parse(checkOut);
  const today = Date.parse(now.toISOString().slice(0, 10));
  if (status === "checked_out" || status === "cancelled") return "checked_out";
  if (status === "checked_in") {
    // within stay window?
    if (!isNaN(co) && today >= co) return "checkout_approaching";
    return "staying";
  }
  if (isNaN(ci)) return "before_arrival";
  if (today < ci) return "before_arrival";
  if (today >= ci && (isNaN(co) || today < co)) return "checked_in";
  return "staying";
}

async function updateBookingStatus(
  env: Env,
  opts: { guestName?: string; roomType?: string; checkIn?: string; reference?: string; status: string },
): Promise<{ ok: boolean; error?: string; changed?: number }> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) return { ok: false, error: "Supabase not configured" };
  // Prefer an exact, stable reference when available; fall back to the
  // composite guest_name + room_type + check_in key otherwise.
  let url = `${base}/rest/v1/bookings?`;
  if (opts.reference) {
    url += `reference=eq.${encodeURIComponent(opts.reference)}`;
  } else {
    url += `guest_name=eq.${encodeURIComponent(opts.guestName ?? "")}&room_type=eq.${encodeURIComponent(opts.roomType ?? "")}&check_in=eq.${encodeURIComponent(opts.checkIn ?? "")}`;
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: opts.status }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Check-in/out failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
  }
  // A 200 from PostgREST on a PATCH can mean ZERO rows matched. That is NOT a
  // success — verify the mutation actually changed a row.
  try {
    const updated = (await res.json()) as unknown[];
    const changed = Array.isArray(updated) ? updated.length : 0;
    if (changed === 0) {
      return { ok: false, error: `No matching booking found to update (status=${opts.status}).`, changed: 0 };
    }
    return { ok: true, changed };
  } catch {
    return { ok: false, error: "Booking update returned no confirmation row." };
  }
}

export async function checkInGuest(
  env: Env,
  o: { guestName?: string; roomType?: string; checkIn?: string; reference?: string },
): Promise<{ ok: boolean; error?: string; changed?: number }> {
  return updateBookingStatus(env, { ...o, status: "checked_in" });
}
export async function checkOutGuest(
  env: Env,
  o: { guestName?: string; roomType?: string; checkIn?: string; reference?: string },
): Promise<{ ok: boolean; error?: string; changed?: number }> {
  return updateBookingStatus(env, { ...o, status: "checked_out" });
}

// ---------------------------------------------------------------------------
// BOOKING CONFIRMATION — promote a pending tala_booking_requests row into the
// operational `bookings` table. Idempotent: calling confirm twice (or after a
// restart) must NOT create a second bookings row. The same MT- reference and
// guest identity/room/dates/guests are preserved; the operational amount comes
// from the request (authoritative), never a guest-supplied price.
// ---------------------------------------------------------------------------
export interface ConfirmBookingResult {
  ok: boolean;
  error?: string;
  bookingId?: string;
  reference?: string;
}
export async function confirmBookingRequest(
  env: Env,
  opts: { reference: string },
): Promise<ConfirmBookingResult> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) return { ok: false, error: "Supabase not configured" };

  // 1) Read the pending request by exact reference.
  const reqRes = await fetch(`${base}/rest/v1/tala_booking_requests?reference=eq.${encodeURIComponent(opts.reference)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!reqRes.ok) return { ok: false, error: `Booking request lookup failed (HTTP ${reqRes.status})` };
  const reqRows = (await reqRes.json().catch(() => [])) as Array<Record<string, unknown>>;
  if (!reqRows.length) return { ok: false, error: `No booking request with reference ${opts.reference}` };
  const r = reqRows[0];

  // 2) Idempotency: if a bookings row with this reference already exists, just
  //    ensure both sides read confirmed and return (no second insert).
  const bRes = await fetch(`${base}/rest/v1/bookings?reference=eq.${encodeURIComponent(opts.reference)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const bRows = (await bRes.json().catch(() => [])) as Array<Record<string, unknown>>;
  if (!bRows.length) {
    if (r.status !== "pending") {
      return { ok: false, error: `Request ${opts.reference} is '${String(r.status)}' (not pending) and has no bookings row.` };
    }
    // 3) Create the operational bookings row, keyed by the request UUID so the
    //    upsert is stable/idempotent. Preserve reference + identity + stay.
    const amount = Number(r.amount ?? 0);
    const upsert = await fetch(`${base}/rest/v1/bookings`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        id: String(r.id),
        reference: opts.reference,
        guest_id: "",
        guest_name: String(r.guest_name ?? ""),
        room_type: String(r.room_type ?? ""),
        check_in: String(r.check_in ?? ""),
        check_out: String(r.check_out ?? ""),
        guests: Number(r.guests ?? 1),
        amount,
        paid_amount: 0,
        status: "confirmed",
        source: "tala_chat",
      }),
    });
    if (!upsert.ok) {
      const body = await upsert.text().catch(() => "");
      return { ok: false, error: `Booking creation failed (HTTP ${upsert.status}): ${body.slice(0, 200)}` };
    }
  }

  // 4) Mark the request confirmed (idempotent — safe if already confirmed).
  await fetch(`${base}/rest/v1/tala_booking_requests?id=eq.${encodeURIComponent(String(r.id))}`, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "confirmed" }),
  });

  return { ok: true, bookingId: String(r.id), reference: opts.reference };
}

// ---------------------------------------------------------------------------
// UNIFIED GUEST STAY STATE — compose from authoritative tables (no duplicates)
// ---------------------------------------------------------------------------
export interface GuestStayState {
  identity: { name?: string; phone?: string };
  booking: GuestStay[];
  phase: StayPhase | null;
  tours: GuestTourRequest[];
  rentals: GuestMotorbikeState[];
  foodOrders: GuestFoodOrder[];
  messages: GuestMessage[];
  housekeeping: Array<{ id: string; room: string; taskType: string; status: string; notes: string }>;
  folio: GuestFolio;
  outstanding: string[];
}

export async function getGuestStayState(
  env: Env,
  db: import("@cloudflare/workers-types").D1Database,
  tenantId: string,
  opts: { name?: string; phone?: string },
): Promise<GuestStayState> {
  const name = opts.name;
  const phone = opts.phone;
  const booking = await getGuestStay(env, { name, phone });

  // Coherent lifecycle: a guest may have a PENDING request in
  // tala_booking_requests but no operational bookings row yet. Surface it as a
  // 'pending' booking so TALA understands the transition (request -> confirmed
  // -> checked_in -> checked_out). The confirmed bookings row is authoritative;
  // we do NOT duplicate when both exist.
  let pendingRequests: GuestStay[] = [];
  if (booking.length === 0) {
    try {
      const base = supabaseBase(env);
      const key = supabaseKey(env);
      if (base && key) {
        const filter = name
          ? `guest_name=eq.${encodeURIComponent(name)}&status=eq.pending`
          : `guest_phone=eq.${encodeURIComponent(phone ?? "")}&status=eq.pending`;
        const pres = await fetch(`${base}/rest/v1/tala_booking_requests?${filter}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        const prows = (await pres.json().catch(() => [])) as Array<Record<string, unknown>>;
        pendingRequests = prows.map((r) => ({
          id: String(r.id),
          reference: String(r.reference ?? ""),
          roomType: String(r.room_type ?? ""),
          guests: Number(r.guests ?? 1),
          checkIn: String(r.check_in ?? ""),
          checkOut: String(r.check_out ?? ""),
          status: "pending",
          amount: Number(r.amount ?? 0),
          paidAmount: 0,
          notes: String(r.notes ?? ""),
        }));
      }
    } catch {
      pendingRequests = [];
    }
  }
  const effectiveBooking = booking.length > 0 ? booking : pendingRequests;

  const phase: StayPhase | null = effectiveBooking[0]
    ? computeStayPhase(effectiveBooking[0].checkIn, effectiveBooking[0].checkOut, effectiveBooking[0].status)
    : null;
  const [tours, rentals, foodOrders, messages, folio] = await Promise.all([
    getGuestTourRequests(env, { name, phone }),
    getGuestMotorbikeState(env, { name, phone }),
    getGuestFoodOrders(env, { name, phone }),
    getGuestMessages(env, { name, phone }),
    getGuestFolio(env, { name, phone }),
  ]);

  // Housekeeping from D1 guest_requests (type=housekeeping) — local only.
  const hkRows = await (async () => {
    try {
      const { listGuestRequests } = await import("./guestRequestRepo.js");
      const all = await listGuestRequests(db, tenantId, { type: "housekeeping" });
      return all
        .filter((r) => (name && r.guestName.toLowerCase() === name.toLowerCase()) || (phone && r.guestPhone === phone))
        .map((r) => ({
          id: r.id,
          room: r.roomType,
          taskType: (r.notes.split("|")[0] || "").replace("task:", "") || "cleaning",
          status: r.status,
          notes: r.notes,
        }));
    } catch {
      return [];
    }
  })();

  const outstanding: string[] = [];
  for (const t of tours) if (t.status === "requested" || t.status === "pending") outstanding.push(`Tour ${t.tourName} (${t.status})`);
  for (const r of rentals) if (r.status === "requested" || r.status === "pending") outstanding.push(`Rental ${r.bikeName} (${r.status})`);
  for (const f of foodOrders) if (f.status !== "delivered" && f.status !== "cancelled") outstanding.push(`Food order ${f.reference} (${f.status})`);
  if (folio.balance > 0) outstanding.push(`Outstanding balance ₱${folio.balance}`);

  return {
    identity: { name, phone },
    booking: effectiveBooking,
    phase,
    tours,
    rentals,
    foodOrders,
    messages,
    housekeeping: hkRows,
    folio,
    outstanding,
  };
}

