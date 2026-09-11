// Owner/admin operational reads + confirmations against Supabase ops tables.
// Bookings, tour/rental requests, motorbike fleet, tour bookings.
// Mirrors Admin managers (Bookings / Tours / Rentals) so TALA and Admin share truth.

import type { Env } from "../../env.js";

function supabaseBase(env: Env): string {
  const raw = env.SUPABASE_URL ? env.SUPABASE_URL.replace(/^["']|["']$/g, "").trim() : "";
  return raw.replace(/\/$/, "");
}
function supabaseKey(env: Env): string {
  const raw = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return raw ? raw.replace(/^["']|["']$/g, "").trim() : "";
}

async function sbFetch(
  env: Env,
  path: string,
  init?: RequestInit & { prefer?: string },
): Promise<Response> {
  const base = supabaseBase(env);
  const key = supabaseKey(env);
  if (!base || !key) throw new Error("Supabase not configured");
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.prefer) headers.Prefer = init.prefer;
  return fetch(`${base}/rest/v1/${path}`, { ...init, headers });
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function makeRef(prefix: string, anchor?: string): string {
  const ymd =
    (anchor || "").replace(/-/g, "").slice(0, 8) ||
    new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${ymd}-${rand}`;
}

export interface BookingSummary {
  id: string;
  reference: string;
  guestName: string;
  guestPhone: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  status: string;
  amount: number;
  paidAmount: number;
  notes: string;
}

export async function listBookings(
  env: Env,
  opts?: { status?: string; limit?: number },
): Promise<BookingSummary[]> {
  let q =
    "bookings?select=id,reference,guest_name,guest_phone,room_type,check_in,check_out,guests,status,amount,paid_amount,notes&order=check_in.desc";
  if (opts?.status) q += `&status=eq.${encodeURIComponent(opts.status)}`;
  q += `&limit=${opts?.limit ?? 50}`;
  const res = await sbFetch(env, q);
  if (!res.ok) throw new Error(`bookings list failed (HTTP ${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id ?? ""),
    reference: String(r.reference ?? ""),
    guestName: String(r.guest_name ?? ""),
    guestPhone: String(r.guest_phone ?? ""),
    roomType: String(r.room_type ?? ""),
    checkIn: String(r.check_in ?? ""),
    checkOut: String(r.check_out ?? ""),
    guests: Number(r.guests ?? 1),
    status: String(r.status ?? ""),
    amount: Number(r.amount ?? 0),
    paidAmount: Number(r.paid_amount ?? 0),
    notes: String(r.notes ?? ""),
  }));
}

export interface PendingRequestSummary {
  id: string;
  reference: string;
  kind: "booking" | "tour" | "rental";
  guestName: string;
  guestPhone: string;
  label: string;
  date: string;
  amount: number;
  status: string;
  createdAt: string;
}

export async function listPendingRequests(env: Env): Promise<PendingRequestSummary[]> {
  const out: PendingRequestSummary[] = [];

  const [bookings, tours, rentals] = await Promise.all([
    sbFetch(
      env,
      "tala_booking_requests?select=id,reference,guest_name,guest_phone,room_type,check_in,amount,status,created_at&status=eq.pending&order=created_at.desc&limit=30",
    )
      .then(async (r) => (r.ok ? ((await r.json()) as Array<Record<string, unknown>>) : []))
      .catch(() => [] as Array<Record<string, unknown>>),
    sbFetch(
      env,
      "tala_tour_requests?select=id,reference,guest_name,guest_phone,tour_name,tour_date,amount,status,created_at&status=in.(requested,pending)&order=created_at.desc&limit=30",
    )
      .then(async (r) => (r.ok ? ((await r.json()) as Array<Record<string, unknown>>) : []))
      .catch(() => [] as Array<Record<string, unknown>>),
    sbFetch(
      env,
      "tala_rental_requests?select=id,reference,guest_name,guest_phone,bike_name,start_date,status,created_at&status=in.(requested,pending)&order=created_at.desc&limit=30",
    )
      .then(async (r) => (r.ok ? ((await r.json()) as Array<Record<string, unknown>>) : []))
      .catch(() => [] as Array<Record<string, unknown>>),
  ]);

  for (const r of bookings) {
    out.push({
      id: String(r.id),
      reference: String(r.reference ?? ""),
      kind: "booking",
      guestName: String(r.guest_name ?? ""),
      guestPhone: String(r.guest_phone ?? ""),
      label: String(r.room_type ?? "Room"),
      date: String(r.check_in ?? ""),
      amount: Number(r.amount ?? 0),
      status: String(r.status ?? "pending"),
      createdAt: String(r.created_at ?? ""),
    });
  }
  for (const r of tours) {
    out.push({
      id: String(r.id),
      reference: String(r.reference ?? ""),
      kind: "tour",
      guestName: String(r.guest_name ?? ""),
      guestPhone: String(r.guest_phone ?? ""),
      label: String(r.tour_name ?? "Tour"),
      date: String(r.tour_date ?? ""),
      amount: Number(r.amount ?? 0),
      status: String(r.status ?? "requested"),
      createdAt: String(r.created_at ?? ""),
    });
  }
  for (const r of rentals) {
    out.push({
      id: String(r.id),
      reference: String(r.reference ?? ""),
      kind: "rental",
      guestName: String(r.guest_name ?? ""),
      guestPhone: String(r.guest_phone ?? ""),
      label: String(r.bike_name ?? "Bike"),
      date: String(r.start_date ?? ""),
      amount: 0,
      status: String(r.status ?? "requested"),
      createdAt: String(r.created_at ?? ""),
    });
  }
  return out;
}

export interface MotorbikeSummary {
  id: string;
  name: string;
  plate: string;
  model: string;
  dailyRate: number;
  active: boolean;
  status: string;
  notes: string;
}

export async function listMotorbikes(env: Env, availableOnly = false): Promise<MotorbikeSummary[]> {
  let q = "motorbikes?select=*&order=name.asc";
  if (availableOnly) q += "&active=eq.true&status=eq.available";
  const res = await sbFetch(env, q);
  if (!res.ok) throw new Error(`motorbikes list failed (HTTP ${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    plate: String(r.plate ?? ""),
    model: String(r.model ?? ""),
    dailyRate: Number(r.daily_rate ?? 0),
    active: r.active !== false && r.active !== 0,
    status: String(r.status ?? "available"),
    notes: String(r.notes ?? ""),
  }));
}

export interface ConfirmResult {
  ok: boolean;
  error?: string;
  reference?: string;
  bookingId?: string;
  message?: string;
}

/**
 * Confirm a pending tour request → tour_bookings row + request status confirmed.
 * Idempotent on reference.
 */
export async function confirmTourRequest(
  env: Env,
  opts: { reference?: string; requestId?: string },
): Promise<ConfirmResult> {
  const key = opts.reference
    ? `reference=eq.${encodeURIComponent(opts.reference)}`
    : opts.requestId
      ? `id=eq.${encodeURIComponent(opts.requestId)}`
      : "";
  if (!key) return { ok: false, error: "reference or requestId required." };

  const reqRes = await sbFetch(env, `tala_tour_requests?${key}&select=*`);
  if (!reqRes.ok) return { ok: false, error: `Tour request lookup failed (HTTP ${reqRes.status})` };
  const reqRows = (await reqRes.json()) as Array<Record<string, unknown>>;
  if (!reqRows.length) return { ok: false, error: "Tour request not found." };
  const r = reqRows[0];
  const reference = String(r.reference || makeRef("TT", String(r.tour_date ?? "")));
  const status = String(r.status ?? "");

  // Already confirmed + has operational row?
  const existing = await sbFetch(
    env,
    `tour_bookings?reference=eq.${encodeURIComponent(reference)}&select=id,reference`,
  );
  const existingRows = existing.ok
    ? ((await existing.json()) as Array<Record<string, unknown>>)
    : [];
  if (existingRows.length) {
    if (status !== "confirmed") {
      await sbFetch(env, `tala_tour_requests?id=eq.${encodeURIComponent(String(r.id))}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed", confirmed_at: new Date().toISOString() }),
      });
    }
    return {
      ok: true,
      reference,
      bookingId: String(existingRows[0].id),
      message: `Tour ${reference} already confirmed.`,
    };
  }

  if (!["requested", "pending"].includes(status)) {
    return { ok: false, error: `Tour request is '${status}' — cannot confirm.` };
  }

  const amount = Number(r.amount ?? 0);
  const bookingId = uid("tb");
  // Resolve tour catalog id by name if possible
  let tourId = "";
  const tourName = String(r.tour_name ?? "");
  if (tourName) {
    const cat = await sbFetch(
      env,
      `tours_catalog?name=eq.${encodeURIComponent(tourName)}&select=id,price,boat_cost,guide_cost,lunch_cost,entrance_fee`,
    ).catch(() => null);
    if (cat?.ok) {
      const cats = (await cat.json()) as Array<Record<string, unknown>>;
      if (cats[0]) tourId = String(cats[0].id ?? "");
    }
  }

  const guests = Number(r.guests ?? 1);
  const insert = await sbFetch(env, "tour_bookings", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      id: bookingId,
      reference,
      tour_id: tourId,
      tour_name: tourName,
      guest_name: String(r.guest_name ?? ""),
      guest_phone: String(r.guest_phone ?? ""),
      date: String(r.tour_date ?? ""),
      guests,
      amount,
      cost: 0,
      paid_amount: 0,
      status: "confirmed",
      notes: String(r.notes ?? ""),
    }),
  });
  if (!insert.ok) {
    const body = await insert.text().catch(() => "");
    return { ok: false, error: `Tour booking create failed (HTTP ${insert.status}): ${body.slice(0, 200)}` };
  }

  await sbFetch(env, `tala_tour_requests?id=eq.${encodeURIComponent(String(r.id))}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      reference,
    }),
  });

  return {
    ok: true,
    reference,
    bookingId,
    message: `Tour ${tourName} confirmed. Reference ${reference}.`,
  };
}

/**
 * Confirm a pending rental request → motorbike_rentals + mark bike rented.
 * Idempotent on reference.
 */
export async function confirmRentalRequest(
  env: Env,
  opts: { reference?: string; requestId?: string },
): Promise<ConfirmResult> {
  const key = opts.reference
    ? `reference=eq.${encodeURIComponent(opts.reference)}`
    : opts.requestId
      ? `id=eq.${encodeURIComponent(opts.requestId)}`
      : "";
  if (!key) return { ok: false, error: "reference or requestId required." };

  const reqRes = await sbFetch(env, `tala_rental_requests?${key}&select=*`);
  if (!reqRes.ok) return { ok: false, error: `Rental request lookup failed (HTTP ${reqRes.status})` };
  const reqRows = (await reqRes.json()) as Array<Record<string, unknown>>;
  if (!reqRows.length) return { ok: false, error: "Rental request not found." };
  const r = reqRows[0];
  const reference = String(r.reference || makeRef("MR", String(r.start_date ?? "")));
  const status = String(r.status ?? "");

  const existing = await sbFetch(
    env,
    `motorbike_rentals?reference=eq.${encodeURIComponent(reference)}&select=id,reference`,
  );
  const existingRows = existing.ok
    ? ((await existing.json()) as Array<Record<string, unknown>>)
    : [];
  if (existingRows.length) {
    if (status !== "confirmed") {
      await sbFetch(env, `tala_rental_requests?id=eq.${encodeURIComponent(String(r.id))}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed", confirmed_at: new Date().toISOString() }),
      });
    }
    return {
      ok: true,
      reference,
      bookingId: String(existingRows[0].id),
      message: `Rental ${reference} already confirmed.`,
    };
  }

  if (!["requested", "pending"].includes(status)) {
    return { ok: false, error: `Rental request is '${status}' — cannot confirm.` };
  }

  const bikeName = String(r.bike_name ?? "");
  const bikes = await listMotorbikes(env);
  const bike =
    bikes.find((b) => b.name.toLowerCase() === bikeName.toLowerCase()) ||
    bikes.find((b) => b.name.toLowerCase().includes(bikeName.toLowerCase()));

  const startDate = String(r.start_date ?? "");
  const endDate = String(r.end_date ?? "");
  const startMs = Date.parse(startDate);
  const endMs = Date.parse(endDate);
  const days =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.max(1, Math.round((endMs - startMs) / 86400000))
      : 1;
  const dailyRate = bike?.dailyRate ?? 0;
  const amount = dailyRate * days;
  const rentalId = uid("rent");

  const insert = await sbFetch(env, "motorbike_rentals", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      id: rentalId,
      reference,
      bike_id: bike?.id ?? "",
      bike_name: bike?.name ?? bikeName,
      guest_name: String(r.guest_name ?? ""),
      guest_phone: String(r.guest_phone ?? ""),
      start_date: startDate,
      end_date: endDate,
      days,
      amount,
      paid_amount: 0,
      deposit: 0,
      status: "active",
      notes: String(r.notes ?? ""),
    }),
  });
  if (!insert.ok) {
    const body = await insert.text().catch(() => "");
    return { ok: false, error: `Rental create failed (HTTP ${insert.status}): ${body.slice(0, 200)}` };
  }

  if (bike?.id) {
    await sbFetch(env, `motorbikes?id=eq.${encodeURIComponent(bike.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "rented" }),
    });
  }

  await sbFetch(env, `tala_rental_requests?id=eq.${encodeURIComponent(String(r.id))}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      reference,
    }),
  });

  return {
    ok: true,
    reference,
    bookingId: rentalId,
    message: `Motorbike ${bike?.name ?? bikeName} rental confirmed. Reference ${reference}. ₱${amount}/total (${days} day(s) × ₱${dailyRate}).`,
  };
}

export async function updateMotorbikeStatus(
  env: Env,
  bikeName: string,
  status: "available" | "rented" | "maintenance",
): Promise<{ ok: boolean; error?: string; bike?: string; status?: string }> {
  const bikes = await listMotorbikes(env);
  const bike =
    bikes.find((b) => b.name.toLowerCase() === bikeName.toLowerCase()) ||
    bikes.find((b) => b.name.toLowerCase().includes(bikeName.toLowerCase()));
  if (!bike) return { ok: false, error: `No motorbike matching '${bikeName}'.` };
  const res = await sbFetch(env, `motorbikes?id=eq.${encodeURIComponent(bike.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Update failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
  }
  return { ok: true, bike: bike.name, status };
}
