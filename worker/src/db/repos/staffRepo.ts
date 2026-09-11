// Staff + payroll repository — authoritative Supabase tables
// (staff_members, shifts, pay_records, payments). Same tables Admin → Staff
// and opsRepo.ts use. Service-role only; never expose to guests.

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

function makeRef(prefix: string): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${ymd}-${rand}`;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  payType: "hourly" | "daily" | "monthly";
  payRate: number;
  active: boolean;
  hiredAt: string;
  notes: string;
}

export interface Shift {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  hoursWorked: number;
  notes: string;
}

export interface PayRecord {
  id: string;
  staffId: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  amount: number;
  paid: boolean;
  paidAt: string;
  method: string;
  notes: string;
}

export interface Payment {
  id: string;
  reference: string;
  date: string;
  category: string;
  direction: "in" | "out";
  amount: number;
  method: string;
  relatedId: string;
  description: string;
  notes: string;
}

function staffFromRow(r: Record<string, unknown>): StaffMember {
  const payType = String(r.pay_type ?? "daily");
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    role: String(r.role ?? ""),
    phone: String(r.phone ?? ""),
    email: String(r.email ?? ""),
    payType: (["hourly", "daily", "monthly"].includes(payType)
      ? payType
      : "daily") as StaffMember["payType"],
    payRate: Number(r.pay_rate ?? 0),
    active: r.active !== false && r.active !== 0,
    hiredAt: String(r.hired_at ?? ""),
    notes: String(r.notes ?? ""),
  };
}

function shiftFromRow(r: Record<string, unknown>): Shift {
  return {
    id: String(r.id ?? ""),
    staffId: String(r.staff_id ?? ""),
    date: String(r.date ?? ""),
    startTime: String(r.start_time ?? ""),
    endTime: String(r.end_time ?? ""),
    hoursWorked: Number(r.hours_worked ?? 0),
    notes: String(r.notes ?? ""),
  };
}

function payFromRow(r: Record<string, unknown>): PayRecord {
  return {
    id: String(r.id ?? ""),
    staffId: String(r.staff_id ?? ""),
    periodStart: String(r.period_start ?? ""),
    periodEnd: String(r.period_end ?? ""),
    hours: Number(r.hours ?? 0),
    amount: Number(r.amount ?? 0),
    paid: r.paid === true || r.paid === 1,
    paidAt: String(r.paid_at ?? ""),
    method: String(r.method ?? "cash"),
    notes: String(r.notes ?? ""),
  };
}

function paymentFromRow(r: Record<string, unknown>): Payment {
  return {
    id: String(r.id ?? ""),
    reference: String(r.reference ?? ""),
    date: String(r.date ?? ""),
    category: String(r.category ?? "other"),
    direction: String(r.direction ?? "in") === "out" ? "out" : "in",
    amount: Number(r.amount ?? 0),
    method: String(r.method ?? "cash"),
    relatedId: String(r.related_id ?? ""),
    description: String(r.description ?? ""),
    notes: String(r.notes ?? ""),
  };
}

export async function listStaff(env: Env, activeOnly = false): Promise<StaffMember[]> {
  const q = activeOnly
    ? "staff_members?select=*&active=eq.true&order=name.asc"
    : "staff_members?select=*&order=name.asc";
  const res = await sbFetch(env, q);
  if (!res.ok) throw new Error(`staff list failed (HTTP ${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map(staffFromRow);
}

export async function listShifts(
  env: Env,
  opts?: { staffId?: string; periodStart?: string; periodEnd?: string },
): Promise<Shift[]> {
  let q = "shifts?select=*&order=date.asc";
  if (opts?.staffId) q += `&staff_id=eq.${encodeURIComponent(opts.staffId)}`;
  if (opts?.periodStart) q += `&date=gte.${encodeURIComponent(opts.periodStart)}`;
  if (opts?.periodEnd) q += `&date=lte.${encodeURIComponent(opts.periodEnd)}`;
  const res = await sbFetch(env, q);
  if (!res.ok) throw new Error(`shifts list failed (HTTP ${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map(shiftFromRow);
}

export async function listPayRecords(
  env: Env,
  opts?: { unpaidOnly?: boolean; limit?: number },
): Promise<PayRecord[]> {
  let q = "pay_records?select=*&order=period_end.desc";
  if (opts?.unpaidOnly) q += "&paid=eq.false";
  if (opts?.limit) q += `&limit=${opts.limit}`;
  const res = await sbFetch(env, q);
  if (!res.ok) throw new Error(`pay_records list failed (HTTP ${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map(payFromRow);
}

export async function listPayments(
  env: Env,
  opts?: { limit?: number; direction?: "in" | "out" },
): Promise<Payment[]> {
  let q = "payments?select=*&order=date.desc";
  if (opts?.direction) q += `&direction=eq.${opts.direction}`;
  if (opts?.limit) q += `&limit=${opts.limit ?? 50}`;
  else q += "&limit=50";
  const res = await sbFetch(env, q);
  if (!res.ok) throw new Error(`payments list failed (HTTP ${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map(paymentFromRow);
}

function computeHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
  let h = eh + em / 60 - (sh + sm / 60);
  if (h < 0) h += 24;
  return Math.max(0, Math.round(h * 100) / 100);
}

export interface PayrollResult {
  created: number;
  total: number;
  records: Array<{ id: string; staffName: string; hours: number; amount: number }>;
  message: string;
}

/**
 * Compute payroll for a date range from logged shifts × pay rates.
 * Creates unpaid PayRecord rows (never marks paid, never moves money).
 */
export async function runPayroll(
  env: Env,
  periodStart: string,
  periodEnd: string,
): Promise<PayrollResult> {
  if (!periodStart || !periodEnd) {
    return { created: 0, total: 0, records: [], message: "Need periodStart and periodEnd." };
  }
  const staff = await listStaff(env, true);
  const shifts = await listShifts(env, { periodStart, periodEnd });
  const created: Array<{ id: string; staffName: string; hours: number; amount: number }> = [];
  let total = 0;

  for (const member of staff) {
    const memberShifts = shifts.filter((s) => s.staffId === member.id);
    const hours = memberShifts.reduce(
      (sum, s) => sum + (s.hoursWorked || computeHours(s.startTime, s.endTime)),
      0,
    );
    const days = new Set(memberShifts.map((s) => s.date)).size;
    const amount =
      member.payType === "hourly"
        ? hours * member.payRate
        : member.payType === "daily"
          ? days * member.payRate
          : member.payRate; // monthly — flat for the period
    if (amount <= 0) continue;

    const id = uid("pay");
    const res = await sbFetch(env, "pay_records", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        id,
        staff_id: member.id,
        period_start: periodStart,
        period_end: periodEnd,
        hours,
        amount,
        paid: false,
        paid_at: "",
        method: "cash",
        notes: `Generated by TALA for ${member.name}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`pay_record insert failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
    total += amount;
    created.push({ id, staffName: member.name, hours, amount });
  }

  if (created.length === 0) {
    return {
      created: 0,
      total: 0,
      records: [],
      message: `No billable shifts in ${periodStart} → ${periodEnd}.`,
    };
  }
  return {
    created: created.length,
    total,
    records: created,
    message: `Created ${created.length} payroll record(s) totalling ₱${total.toLocaleString()} for ${periodStart} → ${periodEnd}.`,
  };
}

export interface MarkPaidResult {
  ok: boolean;
  error?: string;
  amount?: number;
  staffName?: string;
  paymentReference?: string;
  message?: string;
}

/** Mark a PayRecord paid and log the salary expense in payments. */
export async function markPayRecordPaid(
  env: Env,
  payRecordId: string,
  method: string,
): Promise<MarkPaidResult> {
  if (!payRecordId) return { ok: false, error: "payRecordId is required." };
  const safeMethod = ["cash", "gcash", "bank_transfer", "card", "paypal", "other"].includes(method)
    ? method
    : "cash";

  const getRes = await sbFetch(
    env,
    `pay_records?id=eq.${encodeURIComponent(payRecordId)}&select=*`,
  );
  if (!getRes.ok) return { ok: false, error: `PayRecord lookup failed (HTTP ${getRes.status})` };
  const rows = (await getRes.json()) as Array<Record<string, unknown>>;
  if (!rows.length) return { ok: false, error: "PayRecord not found." };
  const rec = payFromRow(rows[0]);
  if (rec.paid) {
    return {
      ok: true,
      amount: rec.amount,
      message: "Already marked paid.",
    };
  }

  const staff = await listStaff(env);
  const member = staff.find((s) => s.id === rec.staffId);
  const staffName = member?.name || "Staff";
  const paidAt = new Date().toISOString().slice(0, 10);

  const patch = await sbFetch(env, `pay_records?id=eq.${encodeURIComponent(payRecordId)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({ paid: true, paid_at: paidAt, method: safeMethod }),
  });
  if (!patch.ok) {
    const body = await patch.text().catch(() => "");
    return { ok: false, error: `Could not mark paid (HTTP ${patch.status}): ${body.slice(0, 200)}` };
  }

  const paymentId = uid("pay");
  const reference = makeRef("SAL");
  const payRes = await sbFetch(env, "payments", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      id: paymentId,
      reference,
      date: paidAt,
      category: "expense",
      direction: "out",
      amount: rec.amount,
      method: safeMethod,
      related_id: payRecordId,
      description: `Salary: ${staffName}`,
      notes: "",
    }),
  });
  if (!payRes.ok) {
    const body = await payRes.text().catch(() => "");
    return {
      ok: false,
      error: `PayRecord marked but payment log failed (HTTP ${payRes.status}): ${body.slice(0, 200)}`,
    };
  }

  return {
    ok: true,
    amount: rec.amount,
    staffName,
    paymentReference: reference,
    message: `Marked paid: ₱${rec.amount.toLocaleString()} via ${safeMethod} for ${staffName}.`,
  };
}

export interface LogPaymentInput {
  direction: "in" | "out";
  category: string;
  amount: number;
  method: string;
  description: string;
  relatedId?: string;
  notes?: string;
}

export async function logPayment(
  env: Env,
  input: LogPaymentInput,
): Promise<{ ok: boolean; reference?: string; error?: string; message?: string }> {
  if (!["in", "out"].includes(input.direction)) {
    return { ok: false, error: "direction must be 'in' or 'out'." };
  }
  if (!(input.amount > 0)) return { ok: false, error: "amount must be > 0." };
  const category = ["booking", "tour", "rental", "food", "other", "expense"].includes(
    input.category,
  )
    ? input.category
    : "other";
  const method = ["cash", "gcash", "bank_transfer", "card", "paypal", "other"].includes(
    input.method,
  )
    ? input.method
    : "cash";
  const id = uid("pay");
  const reference = makeRef("PY");
  const res = await sbFetch(env, "payments", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      id,
      reference,
      date: new Date().toISOString().slice(0, 10),
      category,
      direction: input.direction,
      amount: input.amount,
      method,
      related_id: input.relatedId ?? "",
      description: input.description,
      notes: input.notes ?? "",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Payment log failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
  }
  return {
    ok: true,
    reference,
    message: `Logged ${input.direction === "in" ? "revenue" : "expense"}: ₱${input.amount.toLocaleString()} (${category}).`,
  };
}

export async function getStaffPayrollSnapshot(env: Env): Promise<{
  activeStaff: number;
  unpaidCount: number;
  unpaidTotal: number;
  unpaid: Array<{ id: string; staffName: string; amount: number; periodEnd: string }>;
}> {
  const [staff, unpaid] = await Promise.all([
    listStaff(env, true).catch(() => [] as StaffMember[]),
    listPayRecords(env, { unpaidOnly: true, limit: 50 }).catch(() => [] as PayRecord[]),
  ]);
  const nameById = new Map(staff.map((s) => [s.id, s.name]));
  // Also load all staff names for unpaid records of inactive members
  if (unpaid.some((p) => !nameById.has(p.staffId))) {
    const all = await listStaff(env).catch(() => [] as StaffMember[]);
    for (const s of all) nameById.set(s.id, s.name);
  }
  const unpaidTotal = unpaid.reduce((s, p) => s + p.amount, 0);
  return {
    activeStaff: staff.length,
    unpaidCount: unpaid.length,
    unpaidTotal,
    unpaid: unpaid.slice(0, 20).map((p) => ({
      id: p.id,
      staffName: nameById.get(p.staffId) || "Staff",
      amount: p.amount,
      periodEnd: p.periodEnd,
    })),
  };
}
