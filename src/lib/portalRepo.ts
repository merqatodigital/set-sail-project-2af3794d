// ---------------------------------------------------------------------------
// Guest Portal persistence layer (Supabase-first, server-scoped reads).
//
// Authoritative source of truth for guest-created transactions:
//   - Tours   -> public.tala_tour_requests
//   - Rentals -> public.tala_rental_requests
//   - Food    -> public.tala_food_orders
//   - Messages-> public.tala_guest_messages
//   - Folio   -> derived from the above + public.tala_folio_lines
//
// SECURITY: private READS go through the signed server-side Guest Portal API
// (GET /api/portal/records) which returns only the session guest's rows. The
// anon Supabase role is INSERT-only (guest submissions) — it can never SELECT
// other guests' data. Submissions are anon INSERTs with a REQUESTED/pending
// status; the owner confirms + records payment in admin. Pricing is
// authoritative (tour.price, bike.dailyRate) — never invented. localStorage /
// cms_data blobs are UI cache / demo fallback ONLY.
// ---------------------------------------------------------------------------

import { supabase, isSupabaseConnected } from "@/lib/supabase";
import { generateReference } from "@/admin/ops/opsUtils";

// --- Row shapes (as stored in Supabase, snake_case) -------------------------

export interface PortalTourRequestRow {
  id: string;
  reference: string;
  guest_name: string;
  guest_phone: string;
  tour_name: string;
  tour_date: string;
  guests: number;
  amount: number;
  notes: string;
  status: string;
  source: string;
  confirmed_at: string | null;
  paid_amount: number;
  paid_at: string | null;
  created_at: string;
}

export interface PortalRentalRequestRow {
  id: string;
  reference: string;
  guest_name: string;
  guest_phone: string;
  bike_name: string;
  start_date: string;
  end_date: string;
  days: number;
  amount: number;
  notes: string;
  status: string;
  source: string;
  confirmed_at: string | null;
  paid_amount: number;
  paid_at: string | null;
  created_at: string;
}

export interface PortalBookingRequestRow {
  id: string;
  reference: string;
  guest_name: string;
  guest_phone: string;
  room_type: string;
  check_in: string;
  check_out: string;
  guests: number;
  amount: number;
  notes: string;
  status: string;
  source: string;
  confirmed_at: string | null;
  paid_amount: number;
  paid_at: string | null;
  created_at: string;
}

export interface PortalFoodOrderRow {
  id: string;
  reference: string;
  guest_name: string;
  guest_phone: string;
  items: Array<{ menuItemId: string; name: string; quantity: number; price: number; foodCost: number }>;
  total: number;
  total_cost: number;
  status: string;
  notes: string;
  source: string;
  created_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  paid_amount: number;
  paid_at: string | null;
}

export interface PortalGuestMessageRow {
  id: string;
  guest_name: string;
  guest_phone: string;
  message: string;
  reply: string;
  status: string; // unread | read | replied
  source: string;
  created_at: string;
  replied_at: string | null;
}

export interface PortalFolioLineRow {
  id: string;
  guest_name: string;
  guest_phone: string;
  kind: "charge" | "payment";
  category: string;
  description: string;
  amount: number;
  method: string;
  reference: string;
  related_type: string;
  related_id: string;
  created_at: string;
}

// --- Guest identity ---------------------------------------------------------

export interface PortalGuestIdentity {
  name: string;
  phone: string; // normalized, digits only, leading 63
}

export function normalizePhone(p: string): string {
  return (p || "").replace(/[\s\-+()]/g, "").replace(/^0/, "63");
}

// --- Low-level guard --------------------------------------------------------

function db() {
  return supabase as any;
}

function connected(): boolean {
  return isSupabaseConnected() && !!supabase;
}

// --- Guest session (server-issued, HMAC-signed, stored client-side) ---------

const SESSION_STORAGE_KEY = "mt_portal_session";

export function savePortalToken(token: string): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // ignore storage failures — reads will fall back to the demo blob
  }
}

export function clearPortalToken(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function getPortalToken(): string {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Requests a signed guest session from the server (POST /api/portal/session).
 * The returned token is stored locally and used for all scoped private reads.
 * Returns null when the server cannot issue a session (portal is degraded).
 */
export async function createPortalSession(phone: string, name: string): Promise<string | null> {
  try {
    const res = await fetch("/api/portal/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, name }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    if (!data?.token) return null;
    savePortalToken(data.token);
    return data.token;
  } catch {
    return null;
  }
}

// --- Tours ------------------------------------------------------------------

export interface CreateTourRequestInput {
  guest: PortalGuestIdentity;
  tourName: string;
  tourDate: string; // ISO YYYY-MM-DD
  guests: number;
  amount: number; // authoritative = tour.price * guests
  notes?: string;
}

export async function createTourRequest(input: CreateTourRequestInput): Promise<PortalTourRequestRow | null> {
  if (!connected()) return null;
  const reference = generateReference("TR");
  const payload = {
    reference,
    guest_name: input.guest.name.slice(0, 200),
    guest_phone: normalizePhone(input.guest.phone).slice(0, 200),
    tour_name: input.tourName.slice(0, 200),
    tour_date: input.tourDate.slice(0, 10),
    guests: input.guests,
    amount: input.amount,
    notes: (input.notes || "").trim().slice(0, 1000),
    status: "requested",
    source: "portal",
  };
  const { error } = await db()
    .from("tala_tour_requests")
    .insert(payload);
  if (error) return null;
  // NOTE: anon role is INSERT-only (RLS) — PostgREST's RETURNING is filtered,
  // so build the returned row from our own payload instead of .select().
  return {
    id: "",
    reference,
    guest_name: payload.guest_name,
    guest_phone: payload.guest_phone,
    tour_name: payload.tour_name,
    tour_date: payload.tour_date,
    guests: payload.guests,
    amount: payload.amount,
    notes: payload.notes,
    status: payload.status,
    source: payload.source,
    confirmed_at: null,
    paid_amount: 0,
    paid_at: null,
    created_at: new Date().toISOString(),
  };
}

// --- Private reads (server-side contract) ------------------------------------
// All reads go through GET /api/portal/records (src/server.ts) which verifies
// the signed guest session and returns ONLY the rows whose guest_phone matches
// the session phone. The frontend never touches private rows via the anon key.

export async function fetchGuestRecords(guest: PortalGuestIdentity): Promise<PortalGuestRecords> {
  const empty: PortalGuestRecords = {
    bookings: [],
    tours: [],
    rentals: [],
    foodOrders: [],
    messages: [],
    folioLines: [],
  };

  const token = getPortalToken();
  if (!token) return empty;

  try {
    const res = await fetch("/api/portal/records", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      bookings?: Record<string, unknown>[];
      tours?: Record<string, unknown>[];
      rentals?: Record<string, unknown>[];
      foodOrders?: Record<string, unknown>[];
      messages?: Record<string, unknown>[];
      folioLines?: Record<string, unknown>[];
    };

    return {
      bookings: Array.isArray(data.bookings) ? data.bookings.map(mapBookingRequestRow) : [],
      tours: Array.isArray(data.tours) ? data.tours.map(mapTourRequestRow) : [],
      rentals: Array.isArray(data.rentals) ? data.rentals.map(mapRentalRequestRow) : [],
      foodOrders: Array.isArray(data.foodOrders) ? data.foodOrders.map(mapFoodOrderRow) : [],
      messages: Array.isArray(data.messages) ? data.messages.map(mapGuestMessageRow) : [],
      folioLines: Array.isArray(data.folioLines) ? data.folioLines.map(mapFolioLineRow) : [],
    };
  } catch {
    return empty;
  }
}

function mapTourRequestRow(r: Record<string, unknown>): PortalTourRequestRow {
  return {
    id: String(r.id || ""),
    reference: String(r.reference || ""),
    guest_name: String(r.guest_name || ""),
    guest_phone: String(r.guest_phone || ""),
    tour_name: String(r.tour_name || ""),
    tour_date: String(r.tour_date || ""),
    guests: Number(r.guests || 1),
    amount: Number(r.amount || 0),
    notes: String(r.notes || ""),
    status: String(r.status || "requested"),
    source: String(r.source || "portal"),
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    paid_amount: Number(r.paid_amount || 0),
    paid_at: (r.paid_at as string | null) ?? null,
    created_at: String(r.created_at || ""),
  };
}

// --- Motorbike rentals ------------------------------------------------------

export interface CreateRentalRequestInput {
  guest: PortalGuestIdentity;
  bikeName: string;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  days: number;
  amount: number; // authoritative = bike.dailyRate * days
  notes?: string;
}

export async function createRentalRequest(input: CreateRentalRequestInput): Promise<PortalRentalRequestRow | null> {
  if (!connected()) return null;
  const reference = generateReference("BK");
  const payload = {
    reference,
    guest_name: input.guest.name.slice(0, 200),
    guest_phone: normalizePhone(input.guest.phone).slice(0, 200),
    bike_name: input.bikeName.slice(0, 200),
    start_date: input.startDate.slice(0, 10),
    end_date: input.endDate.slice(0, 10),
    days: input.days,
    amount: input.amount,
    notes: (input.notes || "").trim().slice(0, 1000),
    status: "requested",
    source: "portal",
  };
  const { error } = await db()
    .from("tala_rental_requests")
    .insert(payload);
  if (error) return null;
  // anon is INSERT-only under RLS — build the returned row locally.
  return {
    id: "",
    reference,
    guest_name: payload.guest_name,
    guest_phone: payload.guest_phone,
    bike_name: payload.bike_name,
    start_date: payload.start_date,
    end_date: payload.end_date,
    days: payload.days,
    amount: payload.amount,
    notes: payload.notes,
    status: payload.status,
    source: payload.source,
    confirmed_at: null,
    paid_amount: 0,
    paid_at: null,
    created_at: new Date().toISOString(),
  };
}

export async function fetchRentalRequests(guest: PortalGuestIdentity): Promise<PortalRentalRequestRow[]> {
  const records = await fetchGuestRecords(guest);
  return records.rentals;
}

function mapRentalRequestRow(r: Record<string, unknown>): PortalRentalRequestRow {
  return {
    id: String(r.id || ""),
    reference: String(r.reference || ""),
    guest_name: String(r.guest_name || ""),
    guest_phone: String(r.guest_phone || ""),
    bike_name: String(r.bike_name || ""),
    start_date: String(r.start_date || ""),
    end_date: String(r.end_date || ""),
    days: Number(r.days || 1),
    amount: Number(r.amount || 0),
    notes: String(r.notes || ""),
    status: String(r.status || "requested"),
    source: String(r.source || "portal"),
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    paid_amount: Number(r.paid_amount || 0),
    paid_at: (r.paid_at as string | null) ?? null,
    created_at: String(r.created_at || ""),
  };
}

// --- Room booking requests --------------------------------------------------

export interface CreateBookingRequestInput {
  guest: PortalGuestIdentity;
  roomType: string;
  checkIn: string; // ISO YYYY-MM-DD
  checkOut: string; // ISO YYYY-MM-DD
  guests: number;
  amount: number; // authoritative nightly rate * nights
  notes?: string;
}

export async function createBookingRequest(input: CreateBookingRequestInput): Promise<PortalBookingRequestRow | null> {
  if (!connected()) return null;
  const reference = generateReference("MT");
  const payload = {
    reference,
    guest_name: input.guest.name.slice(0, 200),
    guest_phone: normalizePhone(input.guest.phone).slice(0, 200),
    room_type: input.roomType.slice(0, 200),
    check_in: input.checkIn.slice(0, 10),
    check_out: input.checkOut.slice(0, 10),
    guests: input.guests,
    amount: input.amount,
    notes: (input.notes || "").trim().slice(0, 1000),
    status: "pending",
    source: "portal",
  };
  const { error } = await db()
    .from("tala_booking_requests")
    .insert(payload);
  if (error) return null;
  // anon is INSERT-only under RLS — build the returned row locally.
  return {
    id: "",
    reference,
    guest_name: payload.guest_name,
    guest_phone: payload.guest_phone,
    room_type: payload.room_type,
    check_in: payload.check_in,
    check_out: payload.check_out,
    guests: payload.guests,
    amount: payload.amount,
    notes: payload.notes,
    status: payload.status,
    source: payload.source,
    confirmed_at: null,
    paid_amount: 0,
    paid_at: null,
    created_at: new Date().toISOString(),
  };
}

export async function fetchBookingRequests(guest: PortalGuestIdentity): Promise<PortalBookingRequestRow[]> {
  const records = await fetchGuestRecords(guest);
  return records.bookings;
}

function mapBookingRequestRow(r: Record<string, unknown>): PortalBookingRequestRow {
  return {
    id: String(r.id || ""),
    reference: String(r.reference || ""),
    guest_name: String(r.guest_name || ""),
    guest_phone: String(r.guest_phone || ""),
    room_type: String(r.room_type || ""),
    check_in: String(r.check_in || ""),
    check_out: String(r.check_out || ""),
    guests: Number(r.guests || 1),
    amount: Number(r.amount || 0),
    notes: String(r.notes || ""),
    status: String(r.status || "pending"),
    source: String(r.source || "portal"),
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    paid_amount: Number(r.paid_amount || 0),
    paid_at: (r.paid_at as string | null) ?? null,
    created_at: String(r.created_at || ""),
  };
}

// --- Food orders ------------------------------------------------------------

export interface CreateFoodOrderInput {
  guest: PortalGuestIdentity;
  items: Array<{ menuItemId: string; name: string; quantity: number; price: number; foodCost: number }>;
  total: number; // authoritative sum of item.price * quantity
  totalCost: number;
  notes?: string;
}

export async function createFoodOrder(input: CreateFoodOrderInput): Promise<PortalFoodOrderRow | null> {
  if (!connected()) return null;
  const reference = generateReference("FO");
  const payload = {
    reference,
    guest_name: input.guest.name.slice(0, 200),
    guest_phone: normalizePhone(input.guest.phone).slice(0, 200),
    items: input.items,
    total: input.total,
    total_cost: input.totalCost,
    notes: (input.notes || "").trim().slice(0, 1000),
    status: "pending",
    source: "portal",
  };
  const { error } = await db()
    .from("tala_food_orders")
    .insert(payload);
  if (error) return null;
  // anon is INSERT-only under RLS — build the returned row locally.
  return {
    id: "",
    reference,
    guest_name: payload.guest_name,
    guest_phone: payload.guest_phone,
    items: payload.items,
    total: payload.total,
    total_cost: payload.total_cost,
    status: payload.status,
    notes: payload.notes,
    source: payload.source,
    created_at: new Date().toISOString(),
    confirmed_at: null,
    preparing_at: null,
    ready_at: null,
    delivered_at: null,
    cancelled_at: null,
    paid_amount: 0,
    paid_at: null,
  };
}

export async function fetchFoodOrders(guest: PortalGuestIdentity): Promise<PortalFoodOrderRow[]> {
  const records = await fetchGuestRecords(guest);
  return records.foodOrders;
}

function mapFoodOrderRow(r: Record<string, unknown>): PortalFoodOrderRow {
  const items = (Array.isArray(r.items) ? r.items : []) as PortalFoodOrderRow["items"];
  return {
    id: String(r.id || ""),
    reference: String(r.reference || ""),
    guest_name: String(r.guest_name || ""),
    guest_phone: String(r.guest_phone || ""),
    items,
    total: Number(r.total || 0),
    total_cost: Number(r.total_cost || 0),
    status: String(r.status || "pending"),
    notes: String(r.notes || ""),
    source: String(r.source || "portal"),
    created_at: String(r.created_at || ""),
    confirmed_at: (r.confirmed_at as string | null) ?? null,
    preparing_at: (r.preparing_at as string | null) ?? null,
    ready_at: (r.ready_at as string | null) ?? null,
    delivered_at: (r.delivered_at as string | null) ?? null,
    cancelled_at: (r.cancelled_at as string | null) ?? null,
    paid_amount: Number(r.paid_amount || 0),
    paid_at: (r.paid_at as string | null) ?? null,
  };
}

// --- Messages ---------------------------------------------------------------

export async function sendGuestMessage(
  guest: PortalGuestIdentity,
  message: string,
): Promise<PortalGuestMessageRow | null> {
  if (!connected()) return null;
  const { error } = await db()
    .from("tala_guest_messages")
    .insert({
      guest_name: guest.name.slice(0, 200),
      guest_phone: normalizePhone(guest.phone).slice(0, 200),
      message: message.trim().slice(0, 2000),
      status: "unread",
      source: "portal",
    });
  if (error) return null;
  // anon is INSERT-only under RLS — build the returned row locally.
  return {
    id: "",
    guest_name: guest.name.slice(0, 200),
    guest_phone: normalizePhone(guest.phone).slice(0, 200),
    message: message.trim().slice(0, 2000),
    reply: "",
    status: "unread",
    source: "portal",
    created_at: new Date().toISOString(),
    replied_at: null,
  };
}

export async function fetchGuestMessages(guest: PortalGuestIdentity): Promise<PortalGuestMessageRow[]> {
  if (!connected()) return [];
  const records = await fetchGuestRecords(guest);
  return records.messages;
}

function mapGuestMessageRow(r: Record<string, unknown>): PortalGuestMessageRow {
  return {
    id: String(r.id || ""),
    guest_name: String(r.guest_name || ""),
    guest_phone: String(r.guest_phone || ""),
    message: String(r.message || ""),
    reply: String(r.reply || ""),
    status: String(r.status || "unread"),
    source: String(r.source || "portal"),
    created_at: String(r.created_at || ""),
    replied_at: (r.replied_at as string | null) ?? null,
  };
}

// --- Folio ------------------------------------------------------------------

export async function fetchFolioLines(guest: PortalGuestIdentity): Promise<PortalFolioLineRow[]> {
  const records = await fetchGuestRecords(guest);
  return records.folioLines;
}

function mapFolioLineRow(r: Record<string, unknown>): PortalFolioLineRow {
  return {
    id: String(r.id || ""),
    guest_name: String(r.guest_name || ""),
    guest_phone: String(r.guest_phone || ""),
    kind: (r.kind === "payment" ? "payment" : "charge") as PortalFolioLineRow["kind"],
    category: String(r.category || "other"),
    description: String(r.description || ""),
    amount: Number(r.amount || 0),
    method: String(r.method || "cash"),
    reference: String(r.reference || ""),
    related_type: String(r.related_type || ""),
    related_id: String(r.related_id || ""),
    created_at: String(r.created_at || ""),
  };
}

// --- Aggregate "My Stay" + bill ---------------------------------------------

export interface PortalGuestRecords {
  bookings: PortalBookingRequestRow[];
  tours: PortalTourRequestRow[];
  rentals: PortalRentalRequestRow[];
  foodOrders: PortalFoodOrderRow[];
  messages: PortalGuestMessageRow[];
  folioLines: PortalFolioLineRow[];
}
