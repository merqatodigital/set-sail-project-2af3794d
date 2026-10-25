// Server-side financial data for TallaAgent — STEP 1 ("eyes on the books").
//
// READ-ONLY. This module lets the owner ask TALA money questions ("how did
// we do this month?", "who still owes us?", "what did we spend on?") and get
// answers computed from the same Supabase ops tables the admin dashboard
// uses (bookings, tour_bookings, motorbike_rentals, tala_food_orders,
// payments). The computation mirrors src/admin/pages/FinancialPage.tsx so
// the agent's numbers match the admin page the owner already trusts:
//
//   revenue  = accommodation (bookings.amount)
//            + tours (tour_bookings.amount)
//            + rentals (motorbike_rentals.amount)
//            + food (tala_food_orders.total)        [admin reads the CMS
//                                                     foodOrders blob; this
//                                                     is its Supabase table]
//   costs    = fixed (dailyLabor * days + monthlyUtilities, from CMS
//              financial settings, same formula as FinancialPage)
//            + food cost (tala_food_orders.total_cost)
//            + payments ledger outflows (payments.direction = 'out')
//
// Tour "cost" is intentionally 0: the Supabase tour_bookings table has no
// cost column (the admin's cost field only ever existed in the old CMS
// blob), so there is no authoritative tour cost to report.
//
// Safety: owner/admin tools only (enforced in financeTools.ts), canonical
// resort guard like db/operations.ts, service-role key stays inside the
// Worker, and nothing here writes.

import type { Env } from "../env.js";
import { todayManila } from "../lib/date.js";

const KNOWN_RESORT = "marina_terrace";

// Defaults from src/lib/defaultData.ts settings.financial — used only when
// the CMS settings cannot be read, so answers degrade to the same numbers
// a fresh admin install would show.
export const DEFAULT_DAILY_LABOR_COST = 1550;
export const DEFAULT_MONTHLY_UTILITIES = 31000;

export type FinancePeriod = "month" | "quarter" | "year";

export interface PeriodRange {
  period: FinancePeriod;
  /** YYYY-MM-DD inclusive */
  start: string;
  /** YYYY-MM-DD inclusive */
  end: string;
  days: number;
  label: string;
}

export interface FinanceSettings {
  dailyLaborCost: number;
  monthlyUtilities: number;
}

export interface MoneyRow {
  amount: number;
  paidAmount: number;
  status: string;
  createdDate: string; // YYYY-MM-DD
  guestName: string;
  reference: string;
}

export interface FoodRow {
  total: number;
  totalCost: number;
  status: string;
  createdDate: string;
}

export interface PaymentRow {
  date: string; // YYYY-MM-DD
  category: string;
  direction: string;
  amount: number;
  method: string;
  description: string;
}

export interface FinanceRows {
  bookings: MoneyRow[];
  tours: MoneyRow[];
  rentals: MoneyRow[];
  foodOrders: FoodRow[];
  payments: PaymentRow[];
}

export interface FinancialSummary {
  period: PeriodRange;
  revenue: {
    accommodation: number;
    tours: number;
    rentals: number;
    food: number;
    total: number;
    collected: number;
  };
  costs: {
    fixedLaborAndUtilities: number;
    foodCost: number;
    ledgerExpenses: number;
    ledgerExpensesByCategory: Record<string, number>;
    total: number;
  };
  netProfit: number;
  profitMarginPercent: number;
  counts: { bookings: number; tours: number; rentals: number; foodOrders: number };
}

export interface OutstandingEntry {
  kind: "booking" | "tour" | "rental";
  guest: string;
  reference: string;
  amount: number;
  paid: number;
  balance: number;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isActive(status: string): boolean {
  return status !== "cancelled" && status !== "cancelled_booking";
}

function dateOf(createdAt: unknown): string {
  return String(createdAt ?? "").slice(0, 10);
}

/** Resolve a trailing period (mirrors FinancialPage getPeriodRange). */
export function resolvePeriod(period: FinancePeriod, now: Date = new Date()): PeriodRange {
  const end = todayManila(now);
  const [y, m, d] = end.split("-").map(Number);
  const startDate = new Date(Date.UTC(y, m - 1, d));
  if (period === "month") startDate.setUTCMonth(startDate.getUTCMonth() - 1);
  else if (period === "quarter") startDate.setUTCMonth(startDate.getUTCMonth() - 3);
  else startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  const start = startDate.toISOString().slice(0, 10);
  const days = Math.max(
    1,
    Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000),
  );
  const label =
    period === "month" ? "last month" : period === "quarter" ? "last quarter" : "last year";
  return { period, start, end, days, label };
}

const inRange = (date: string, r: PeriodRange) => date >= r.start && date <= r.end;

/** Pure computation — unit-tested without any network. */
export function computeFinancialSummary(
  rows: FinanceRows,
  range: PeriodRange,
  settings: FinanceSettings,
): FinancialSummary {
  const bookings = rows.bookings.filter((b) => isActive(b.status) && inRange(b.createdDate, range));
  const tours = rows.tours.filter((t) => isActive(t.status) && inRange(t.createdDate, range));
  const rentals = rows.rentals.filter((r) => isActive(r.status) && inRange(r.createdDate, range));
  const food = rows.foodOrders.filter((f) => isActive(f.status) && inRange(f.createdDate, range));

  const revenueAccommodation = bookings.reduce((s, b) => s + b.amount, 0);
  const revenueTours = tours.reduce((s, t) => s + t.amount, 0);
  const revenueRentals = rentals.reduce((s, r) => s + r.amount, 0);
  const revenueFood = food.reduce((s, f) => s + f.total, 0);
  const totalRevenue = revenueAccommodation + revenueTours + revenueRentals + revenueFood;

  const collected =
    bookings.reduce((s, b) => s + b.paidAmount, 0) +
    tours.reduce((s, t) => s + t.paidAmount, 0) +
    rentals.reduce((s, r) => s + r.paidAmount, 0);

  // Same fixed-cost formula as FinancialPage: daily labor * days + monthly utilities.
  const fixedCosts = settings.dailyLaborCost * range.days + settings.monthlyUtilities;
  const costFood = food.reduce((s, f) => s + f.totalCost, 0);

  const ledgerOut = rows.payments.filter(
    (p) => p.direction === "out" && inRange(p.date, range),
  );
  const ledgerExpenses = ledgerOut.reduce((s, p) => s + p.amount, 0);
  const ledgerExpensesByCategory: Record<string, number> = {};
  for (const p of ledgerOut) {
    const cat = p.category || "other";
    ledgerExpensesByCategory[cat] = (ledgerExpensesByCategory[cat] ?? 0) + p.amount;
  }

  const totalCosts = fixedCosts + costFood + ledgerExpenses;
  const netProfit = totalRevenue - totalCosts;

  return {
    period: range,
    revenue: {
      accommodation: revenueAccommodation,
      tours: revenueTours,
      rentals: revenueRentals,
      food: revenueFood,
      total: totalRevenue,
      collected,
    },
    costs: {
      fixedLaborAndUtilities: fixedCosts,
      foodCost: costFood,
      ledgerExpenses,
      ledgerExpensesByCategory,
      total: totalCosts,
    },
    netProfit,
    profitMarginPercent:
      totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0,
    counts: {
      bookings: bookings.length,
      tours: tours.length,
      rentals: rentals.length,
      foodOrders: food.length,
    },
  };
}

/** All unpaid balances right now (not period-limited). Pure. */
export function computeOutstanding(rows: FinanceRows): OutstandingEntry[] {
  const out: OutstandingEntry[] = [];
  const push = (kind: OutstandingEntry["kind"], r: MoneyRow) => {
    if (!isActive(r.status)) return;
    const balance = Math.max(0, r.amount - r.paidAmount);
    if (balance > 0) {
      out.push({
        kind,
        guest: r.guestName,
        reference: r.reference,
        amount: r.amount,
        paid: r.paidAmount,
        balance,
      });
    }
  };
  rows.bookings.forEach((r) => push("booking", r));
  rows.tours.forEach((r) => push("tour", r));
  rows.rentals.forEach((r) => push("rental", r));
  return out.sort((a, b) => b.balance - a.balance);
}

// ---------------------------------------------------------------------------
// Supabase reads (Worker-side only; same pattern as db/operations.ts)
// ---------------------------------------------------------------------------

function supabaseConfig(env: Env): { base: string; key: string } {
  const base = env.SUPABASE_URL
    ? env.SUPABASE_URL.replace(/^["']|["']$/g, "").trim().replace(/\/$/, "")
    : "";
  const keyRaw = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const key = keyRaw ? keyRaw.replace(/^["']|["']$/g, "").trim() : "";
  return { base, key };
}

async function supabaseGet(
  base: string,
  key: string,
  table: string,
  select: string,
  order?: string,
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(`${base}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  if (order) url.searchParams.set("order", order);
  const res = await fetch(url.toString(), {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Supabase ${table} read failed (HTTP ${res.status})`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

export interface FinanceFetch {
  rows: FinanceRows | null;
  settings: FinanceSettings;
  readError?: string;
}

/** Fetch every table the finance tools need. Fails soft with readError. */
export async function fetchFinanceRows(env: Env, tenantId: string): Promise<FinanceFetch> {
  const fallbackSettings: FinanceSettings = {
    dailyLaborCost: DEFAULT_DAILY_LABOR_COST,
    monthlyUtilities: DEFAULT_MONTHLY_UTILITIES,
  };
  if (tenantId !== KNOWN_RESORT) {
    return { rows: null, settings: fallbackSettings, readError: "Unknown resort." };
  }
  const { base, key } = supabaseConfig(env);
  if (!base || !key) {
    return {
      rows: null,
      settings: fallbackSettings,
      readError: "Supabase is not configured for the agent (SUPABASE_URL + key).",
    };
  }

  try {
    const [bookingsRaw, toursRaw, rentalsRaw, foodRaw, paymentsRaw, settings] =
      await Promise.all([
        supabaseGet(base, key, "bookings", "reference,guest_name,amount,paid_amount,status,created_at", "created_at.desc"),
        supabaseGet(base, key, "tour_bookings", "reference,guest_name,amount,paid_amount,status,created_at", "created_at.desc"),
        supabaseGet(base, key, "motorbike_rentals", "reference,guest_name,amount,paid_amount,status,created_at", "created_at.desc"),
        supabaseGet(base, key, "tala_food_orders", "total,total_cost,status,created_at", "created_at.desc"),
        supabaseGet(base, key, "payments", "date,category,direction,amount,method,description", "date.desc"),
        fetchFinancialSettings(base, key),
      ]);

    const money = (r: Record<string, unknown>): MoneyRow => ({
      amount: num(r.amount),
      paidAmount: num(r.paid_amount),
      status: String(r.status ?? ""),
      createdDate: dateOf(r.created_at),
      guestName: String(r.guest_name ?? ""),
      reference: String(r.reference ?? ""),
    });

    return {
      settings,
      rows: {
        bookings: bookingsRaw.map(money),
        tours: toursRaw.map(money),
        rentals: rentalsRaw.map(money),
        foodOrders: foodRaw.map((r) => ({
          total: num(r.total),
          totalCost: num(r.total_cost),
          status: String(r.status ?? ""),
          createdDate: dateOf(r.created_at),
        })),
        payments: paymentsRaw.map((r) => ({
          date: dateOf(r.date),
          category: String(r.category ?? "other"),
          direction: String(r.direction ?? "in"),
          amount: num(r.amount),
          method: String(r.method ?? ""),
          description: String(r.description ?? ""),
        })),
      },
    };
  } catch (err) {
    return { rows: null, settings: fallbackSettings, readError: (err as Error).message };
  }
}

/** Financial settings (labor/utilities) live in the CMS payload. */
export async function fetchFinancialSettings(base: string, key: string): Promise<FinanceSettings> {
  const fallback: FinanceSettings = {
    dailyLaborCost: DEFAULT_DAILY_LABOR_COST,
    monthlyUtilities: DEFAULT_MONTHLY_UTILITIES,
  };
  try {
    const url = new URL(`${base}/rest/v1/cms_data`);
    url.searchParams.set("select", "value");
    url.searchParams.set("key", "eq.marina_terrace_payload");
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fallback;
    const rows = (await res.json()) as Array<{ value?: unknown }>;
    let value: unknown = rows[0]?.value;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return fallback; }
    }
    const financial = (value as { settings?: { financial?: Record<string, unknown> } })?.settings
      ?.financial;
    if (!financial) return fallback;
    return {
      dailyLaborCost: num(financial.dailyLaborCost) || fallback.dailyLaborCost,
      monthlyUtilities: num(financial.monthlyUtilities) || fallback.monthlyUtilities,
    };
  } catch {
    return fallback;
  }
}
