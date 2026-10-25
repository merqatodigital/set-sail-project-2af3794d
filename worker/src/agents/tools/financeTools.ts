// Finance tools — STEP 1 ("eyes on the books"). OWNER/ADMIN ONLY, READ-ONLY.
//
// getFinancialSummary   "how did we do this month / quarter / year?"
// listOutstandingBalances "who still owes us money?"
// listPayments          "what money came in / went out recently?"
//
// Every tool double-checks the role server-side (the tool list already hides
// these from guests, but a tool must never trust that it was only offered to
// the right role). Numbers come from db/finance.ts, which mirrors the admin
// FinancialPage math over the Supabase ops tables.

import type { TallaTool, ToolContext } from "../types.js";
import {
  fetchFinanceRows,
  computeFinancialSummary,
  computeOutstanding,
  resolvePeriod,
  type FinancePeriod,
} from "../../db/finance.js";

function ownerOnly(ctx: ToolContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

const peso = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;

export const getFinancialSummaryTool: TallaTool = {
  name: "getFinancialSummary",
  description:
    "OWNER/ADMIN ONLY. Read the resort's real financial picture for a trailing period: revenue split by accommodation, tours, motorbike rentals and food; money actually collected; costs (fixed labor+utilities, food cost, and expenses from the payments ledger, broken down by category); net profit and margin. Use this when the owner asks how the business did, how much money was made, what was earned or spent, or for a financial summary. period: month (last ~30 days), quarter (~3 months), year (~12 months).",
  parameters: {
    type: "object",
    properties: {
      period: {
        type: "string",
        enum: ["month", "quarter", "year"],
        description: "Trailing period to summarize. Default month.",
      },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only the owner can see finances." };
    const period = (["month", "quarter", "year"].includes(String(args.period))
      ? args.period
      : "month") as FinancePeriod;
    try {
      const { rows, settings, readError } = await fetchFinanceRows(ctx.env, ctx.tenantId);
      if (!rows) return { success: false, error: readError ?? "Finance data unavailable." };
      const range = resolvePeriod(period);
      const s = computeFinancialSummary(rows, range, settings);
      return {
        success: true,
        data: {
          period: `${s.period.label} (${s.period.start} to ${s.period.end})`,
          revenue: {
            accommodation: peso(s.revenue.accommodation),
            tours: peso(s.revenue.tours),
            rentals: peso(s.revenue.rentals),
            food: peso(s.revenue.food),
            total: peso(s.revenue.total),
            collectedSoFar: peso(s.revenue.collected),
          },
          costs: {
            fixedLaborAndUtilities: peso(s.costs.fixedLaborAndUtilities),
            foodCost: peso(s.costs.foodCost),
            ledgerExpenses: peso(s.costs.ledgerExpenses),
            ledgerExpensesByCategory: Object.fromEntries(
              Object.entries(s.costs.ledgerExpensesByCategory).map(([k, v]) => [k, peso(v)]),
            ),
            total: peso(s.costs.total),
          },
          netProfit: peso(s.netProfit),
          profitMargin: `${s.profitMarginPercent}%`,
          activityCounts: s.counts,
          rawNumbers: s,
          note: "Revenue is booked amounts for the period (not only collected cash). collectedSoFar is paid_amount received against those bookings. Fixed costs use the admin financial settings (daily labor x days + monthly utilities).",
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};

export const listOutstandingBalancesTool: TallaTool = {
  name: "listOutstandingBalances",
  description:
    "OWNER/ADMIN ONLY. List every guest who still owes money right now: unpaid balances across room bookings, tour bookings and motorbike rentals (amount minus paid), largest first, with a grand total. Use when the owner asks who hasn't paid, who owes money, outstanding balances, or unpaid bills.",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (_args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only the owner can see balances." };
    try {
      const { rows, readError } = await fetchFinanceRows(ctx.env, ctx.tenantId);
      if (!rows) return { success: false, error: readError ?? "Finance data unavailable." };
      const entries = computeOutstanding(rows);
      const total = entries.reduce((s, e) => s + e.balance, 0);
      return {
        success: true,
        data: {
          totalOutstanding: peso(total),
          count: entries.length,
          balances: entries.slice(0, 30).map((e) => ({
            guest: e.guest,
            kind: e.kind,
            reference: e.reference,
            amount: peso(e.amount),
            paid: peso(e.paid),
            balance: peso(e.balance),
          })),
          truncated: entries.length > 30,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};

export const listPaymentsTool: TallaTool = {
  name: "listPayments",
  description:
    "OWNER/ADMIN ONLY. Read the payments ledger (the resort's cash book): recent money in and money out with date, category, method and amount, plus totals for the listed entries. Use when the owner asks about recent payments, expenses, what was spent, or cash flow. direction: in, out, or all (default all).",
  parameters: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["in", "out", "all"],
        description: "Filter by money in, money out, or all. Default all.",
      },
      limit: { type: "number", description: "How many recent entries (default 20, max 50)." },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only the owner can see the ledger." };
    try {
      const { rows, readError } = await fetchFinanceRows(ctx.env, ctx.tenantId);
      if (!rows) return { success: false, error: readError ?? "Finance data unavailable." };
      const direction = ["in", "out"].includes(String(args.direction))
        ? String(args.direction)
        : "all";
      const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit ?? 20)) || 20));
      const filtered = rows.payments
        .filter((p) => direction === "all" || p.direction === direction)
        .slice(0, limit);
      return {
        success: true,
        data: {
          direction,
          totalIn: peso(filtered.filter((p) => p.direction === "in").reduce((s, p) => s + p.amount, 0)),
          totalOut: peso(filtered.filter((p) => p.direction === "out").reduce((s, p) => s + p.amount, 0)),
          payments: filtered.map((p) => ({
            date: p.date,
            direction: p.direction,
            category: p.category,
            amount: peso(p.amount),
            method: p.method,
            description: p.description,
          })),
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};
