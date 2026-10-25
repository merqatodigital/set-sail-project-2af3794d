// Step 1 finance tools — pure computation tests (no network, no D1).
// The math mirrors src/admin/pages/FinancialPage.tsx so the agent's
// numbers match the admin dashboard.

import { describe, it, expect } from "vitest";
import {
  computeFinancialSummary,
  computeOutstanding,
  resolvePeriod,
  type FinanceRows,
} from "../src/db/finance.js";
import { getTools } from "../src/agents/tools/index.js";

const rows: FinanceRows = {
  bookings: [
    { amount: 10000, paidAmount: 4000, status: "confirmed", createdDate: "2026-10-10", guestName: "Ana", reference: "B1" },
    { amount: 5000, paidAmount: 5000, status: "cancelled", createdDate: "2026-10-10", guestName: "Ghost", reference: "BX" },
    { amount: 7000, paidAmount: 7000, status: "confirmed", createdDate: "2025-01-01", guestName: "Old", reference: "B0" },
  ],
  tours: [
    { amount: 3000, paidAmount: 3000, status: "confirmed", createdDate: "2026-10-11", guestName: "Ben", reference: "T1" },
  ],
  rentals: [
    { amount: 2000, paidAmount: 500, status: "active", createdDate: "2026-10-12", guestName: "Cora", reference: "R1" },
  ],
  foodOrders: [
    { total: 1000, totalCost: 400, status: "delivered", createdDate: "2026-10-12" },
    { total: 9999, totalCost: 1, status: "cancelled", createdDate: "2026-10-12" },
  ],
  payments: [
    { date: "2026-10-13", category: "utilities", direction: "out", amount: 2000, method: "cash", description: "Power" },
    { date: "2026-10-13", category: "booking", direction: "in", amount: 4000, method: "gcash", description: "Ana deposit" },
    { date: "2025-06-01", category: "supplies", direction: "out", amount: 777, method: "cash", description: "Old" },
  ],
};

const settings = { dailyLaborCost: 1000, monthlyUtilities: 30000 };

describe("finance — resolvePeriod", () => {
  it("month is a trailing ~30 day window ending today (Manila)", () => {
    const r = resolvePeriod("month", new Date("2026-10-25T12:00:00Z"));
    expect(r.end).toBe("2026-10-25");
    expect(r.start).toBe("2026-09-25");
    expect(r.days).toBe(30);
  });
});

describe("finance — computeFinancialSummary", () => {
  const range = resolvePeriod("month", new Date("2026-10-25T12:00:00Z"));
  const s = computeFinancialSummary(rows, range, settings);

  it("sums revenue by category, excluding cancelled and out-of-period rows", () => {
    expect(s.revenue.accommodation).toBe(10000);
    expect(s.revenue.tours).toBe(3000);
    expect(s.revenue.rentals).toBe(2000);
    expect(s.revenue.food).toBe(1000);
    expect(s.revenue.total).toBe(16000);
  });

  it("tracks collected (paid_amount) separately from booked revenue", () => {
    expect(s.revenue.collected).toBe(4000 + 3000 + 500);
  });

  it("costs = fixed (labor*days + utilities) + food cost + ledger out only", () => {
    expect(s.costs.fixedLaborAndUtilities).toBe(1000 * 30 + 30000);
    expect(s.costs.foodCost).toBe(400);
    expect(s.costs.ledgerExpenses).toBe(2000);
    expect(s.costs.ledgerExpensesByCategory).toEqual({ utilities: 2000 });
    expect(s.costs.total).toBe(60000 + 400 + 2000);
  });

  it("net profit and margin follow from the totals", () => {
    expect(s.netProfit).toBe(16000 - 62400);
    expect(s.profitMarginPercent).toBe(Math.round(((16000 - 62400) / 16000) * 100));
  });
});

describe("finance — computeOutstanding", () => {
  it("lists unpaid balances across bookings/tours/rentals, biggest first, skipping cancelled and paid-up", () => {
    const out = computeOutstanding(rows);
    expect(out.map((o) => o.reference)).toEqual(["B1", "R1"]);
    expect(out[0].balance).toBe(6000);
    expect(out[1].balance).toBe(1500);
  });
});

describe("finance — tool registration", () => {
  it("owner/admin get the finance tools; guests never do", () => {
    const ownerNames = getTools("owner").map((t) => t.name);
    expect(ownerNames).toContain("getFinancialSummary");
    expect(ownerNames).toContain("listOutstandingBalances");
    expect(ownerNames).toContain("listPayments");

    const guestNames = getTools("guest").map((t) => t.name);
    expect(guestNames).not.toContain("getFinancialSummary");
    expect(guestNames).not.toContain("listOutstandingBalances");
    expect(guestNames).not.toContain("listPayments");
    expect(getTools(null).map((t) => t.name)).not.toContain("getFinancialSummary");
  });
});
