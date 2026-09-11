// Owner/admin staff + payroll + payment tools — authoritative Supabase ops tables.
// These are the SAME tables Admin → Staff / Payments / Financial use.

import type { TallaTool } from "../types.js";
import {
  listStaff,
  listPayRecords,
  listPayments,
  runPayroll,
  markPayRecordPaid,
  logPayment,
  getStaffPayrollSnapshot,
} from "../../db/repos/staffRepo.js";
import {
  listBookings,
  listPendingRequests,
  listMotorbikes,
  confirmTourRequest,
  confirmRentalRequest,
  updateMotorbikeStatus,
} from "../../db/repos/opsAdminRepo.js";
import { confirmBookingRequest } from "../../db/repos/guestStateRepo.js";

function ownerOnly(ctx: { role: string | null }): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export const listStaffTool: TallaTool = {
  name: "listStaff",
  description:
    "OWNER/ADMIN ONLY. List staff members (name, role, pay type/rate, active). Use when the owner asks who is on the team, pay rates, or staff roster.",
  parameters: {
    type: "object",
    properties: {
      activeOnly: { type: "boolean", description: "If true, only active staff. Default true." },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can view the roster." };
    try {
      const activeOnly = args.activeOnly === undefined ? true : Boolean(args.activeOnly);
      const staff = await listStaff(ctx.env as never, activeOnly);
      return {
        success: true,
        data: {
          count: staff.length,
          staff: staff.map((s) => ({
            id: s.id,
            name: s.name,
            role: s.role,
            payType: s.payType,
            payRate: s.payRate,
            active: s.active,
            phone: s.phone,
          })),
        },
      };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const getPayrollSnapshotTool: TallaTool = {
  name: "getPayrollSnapshot",
  description:
    "OWNER/ADMIN ONLY. Snapshot of unpaid payroll and active staff count. Use for morning brief, cash planning, or 'what do we owe staff?'.",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (_args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can view payroll." };
    try {
      const snap = await getStaffPayrollSnapshot(ctx.env as never);
      return { success: true, data: snap };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const runPayrollTool: TallaTool = {
  name: "runPayroll",
  description:
    "OWNER/ADMIN ONLY. Compute payroll for a date range from logged shifts × each staff member's pay rate. Creates unpaid PayRecord rows (does NOT mark paid or move money). Report totals after.",
  parameters: {
    type: "object",
    properties: {
      periodStart: { type: "string", description: "Period start YYYY-MM-DD" },
      periodEnd: { type: "string", description: "Period end YYYY-MM-DD" },
    },
    required: ["periodStart", "periodEnd"],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can run payroll." };
    try {
      const result = await runPayroll(ctx.env as never, str(args.periodStart), str(args.periodEnd));
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const markPayRecordPaidTool: TallaTool = {
  name: "markPayRecordPaid",
  description:
    "OWNER/ADMIN ONLY. Mark a staff PayRecord as paid (cash/gcash/bank_transfer) and log the salary expense. Provide payRecordId from runPayroll or getPayrollSnapshot.",
  parameters: {
    type: "object",
    properties: {
      payRecordId: { type: "string", description: "PayRecord id" },
      method: { type: "string", description: "cash | gcash | bank_transfer | card | other" },
    },
    required: ["payRecordId", "method"],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can mark payroll paid." };
    try {
      const result = await markPayRecordPaid(
        ctx.env as never,
        str(args.payRecordId),
        str(args.method, "cash"),
      );
      if (!result.ok) return { success: false, error: result.error };
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const logPaymentTool: TallaTool = {
  name: "logPayment",
  description:
    "OWNER/ADMIN ONLY. Record a money movement in the payments ledger: revenue (booking/tour/rental/food/other) or expense. Does not alter booking balances — use recordPayment for guest folio payments.",
  parameters: {
    type: "object",
    properties: {
      direction: { type: "string", description: "'in' revenue or 'out' expense" },
      category: {
        type: "string",
        description: "booking | tour | rental | food | other | expense",
      },
      amount: { type: "number", description: "Amount in PHP" },
      method: { type: "string", description: "cash | gcash | bank_transfer | card | other" },
      description: { type: "string", description: "Short human description" },
      relatedId: { type: "string", description: "Optional related booking/tour/rental id" },
    },
    required: ["direction", "category", "amount", "method", "description"],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can log payments." };
    try {
      const direction = str(args.direction) === "out" ? "out" : "in";
      const result = await logPayment(ctx.env as never, {
        direction,
        category: str(args.category, "other"),
        amount: num(args.amount),
        method: str(args.method, "cash"),
        description: str(args.description),
        relatedId: str(args.relatedId) || undefined,
      });
      if (!result.ok) return { success: false, error: result.error };
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const listPaymentsTool: TallaTool = {
  name: "listPayments",
  description:
    "OWNER/ADMIN ONLY. List recent payments/revenues/expenses from the ledger.",
  parameters: {
    type: "object",
    properties: {
      direction: { type: "string", description: "Optional filter: in | out" },
      limit: { type: "number", description: "Max rows (default 30)" },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can list payments." };
    try {
      const direction =
        str(args.direction) === "in" || str(args.direction) === "out"
          ? (str(args.direction) as "in" | "out")
          : undefined;
      const payments = await listPayments(ctx.env as never, {
        direction,
        limit: num(args.limit, 30) || 30,
      });
      return { success: true, data: { count: payments.length, payments } };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const listBookingsTool: TallaTool = {
  name: "listBookings",
  description:
    "OWNER/ADMIN ONLY. List operational room bookings (reference, guest, room, dates, status, amounts).",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Optional: pending | confirmed | checked_in | checked_out | cancelled",
      },
      limit: { type: "number", description: "Max rows (default 40)" },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can list all bookings." };
    try {
      const bookings = await listBookings(ctx.env as never, {
        status: str(args.status) || undefined,
        limit: num(args.limit, 40) || 40,
      });
      return { success: true, data: { count: bookings.length, bookings } };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const listPendingRequestsTool: TallaTool = {
  name: "listPendingRequests",
  description:
    "OWNER/ADMIN ONLY. List pending guest requests awaiting confirmation: room bookings, tours, and motorbike rentals. Use before confirming anything.",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (_args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can list pending requests." };
    try {
      const requests = await listPendingRequests(ctx.env as never);
      return {
        success: true,
        data: {
          count: requests.length,
          bookings: requests.filter((r) => r.kind === "booking"),
          tours: requests.filter((r) => r.kind === "tour"),
          rentals: requests.filter((r) => r.kind === "rental"),
          all: requests,
        },
      };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const listMotorbikesTool: TallaTool = {
  name: "listMotorbikes",
  description:
    "List motorbike fleet (name, plate, daily rate, status). Guests see available bikes only; owner/admin see full fleet.",
  parameters: {
    type: "object",
    properties: {
      availableOnly: {
        type: "boolean",
        description: "If true, only active+available bikes. Guests always get availableOnly.",
      },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    try {
      const isOwner = ownerOnly(ctx);
      const availableOnly = isOwner ? Boolean(args.availableOnly) : true;
      const bikes = await listMotorbikes(ctx.env as never, availableOnly || !isOwner);
      return {
        success: true,
        data: {
          count: bikes.length,
          bikes: bikes.map((b) => ({
            name: b.name,
            model: b.model,
            dailyRate: b.dailyRate,
            status: b.status,
            active: b.active,
            ...(isOwner ? { id: b.id, plate: b.plate } : {}),
          })),
        },
      };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const confirmTourTool: TallaTool = {
  name: "confirmTour",
  description:
    "OWNER/ADMIN ONLY. Confirm a pending tour request (from listPendingRequests) and create the operational tour_bookings row. Prefer exact reference (TT-…); requestId also accepted.",
  parameters: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Tour request reference TT-YYYYMMDD-XXXX" },
      requestId: { type: "string", description: "UUID of tala_tour_requests row" },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff can confirm tours." };
    try {
      const result = await confirmTourRequest(ctx.env as never, {
        reference: str(args.reference) || undefined,
        requestId: str(args.requestId) || undefined,
      });
      if (!result.ok) return { success: false, error: result.error };
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const confirmRentalTool: TallaTool = {
  name: "confirmRental",
  description:
    "OWNER/ADMIN ONLY. Confirm a pending motorbike rental request, create motorbike_rentals row, and mark the bike rented. Prefer exact reference (MR-…).",
  parameters: {
    type: "object",
    properties: {
      reference: { type: "string", description: "Rental request reference MR-YYYYMMDD-XXXX" },
      requestId: { type: "string", description: "UUID of tala_rental_requests row" },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff can confirm rentals." };
    try {
      const result = await confirmRentalRequest(ctx.env as never, {
        reference: str(args.reference) || undefined,
        requestId: str(args.requestId) || undefined,
      });
      if (!result.ok) return { success: false, error: result.error };
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const updateMotorbikeStatusTool: TallaTool = {
  name: "updateMotorbikeStatus",
  description:
    "OWNER/ADMIN ONLY. Set a motorbike status to available, rented, or maintenance.",
  parameters: {
    type: "object",
    properties: {
      bikeName: { type: "string", description: "Motorbike name" },
      status: { type: "string", description: "available | rented | maintenance" },
    },
    required: ["bikeName", "status"],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff can update bike status." };
    const status = str(args.status) as "available" | "rented" | "maintenance";
    if (!["available", "rented", "maintenance"].includes(status)) {
      return { success: false, error: "status must be available, rented, or maintenance." };
    }
    try {
      const result = await updateMotorbikeStatus(ctx.env as never, str(args.bikeName), status);
      if (!result.ok) return { success: false, error: result.error };
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

/** Alias confirmBooking by requestId as well as reference (admin UIs often have id). */
export const confirmBookingByIdTool: TallaTool = {
  name: "confirmBookingRequest",
  description:
    "OWNER/ADMIN ONLY. Confirm a pending room booking request by MT- reference (same as confirmBooking). Prefer reference.",
  parameters: {
    type: "object",
    properties: {
      reference: { type: "string", description: "MT-YYYYMMDD-XXXX" },
    },
    required: ["reference"],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff can confirm bookings." };
    const reference = str(args.reference);
    if (!reference) return { success: false, error: "reference is required." };
    try {
      const r = await confirmBookingRequest(ctx.env as never, { reference });
      if (!r.ok) return { success: false, error: r.error };
      return {
        success: true,
        data: {
          reference: r.reference,
          bookingId: r.bookingId,
          message: `Booking ${r.reference} confirmed.`,
        },
      };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};

export const listUnpaidPayRecordsTool: TallaTool = {
  name: "listUnpaidPayRecords",
  description: "OWNER/ADMIN ONLY. List unpaid PayRecord rows with amounts and periods.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max rows (default 40)" },
    },
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ownerOnly(ctx)) return { success: false, error: "Only staff/owner can view pay records." };
    try {
      const [records, staff] = await Promise.all([
        listPayRecords(ctx.env as never, { unpaidOnly: true, limit: num(args.limit, 40) || 40 }),
        listStaff(ctx.env as never),
      ]);
      const names = new Map(staff.map((s) => [s.id, s.name]));
      return {
        success: true,
        data: {
          count: records.length,
          total: records.reduce((s, r) => s + r.amount, 0),
          records: records.map((r) => ({
            id: r.id,
            staffName: names.get(r.staffId) || "Staff",
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            hours: r.hours,
            amount: r.amount,
          })),
        },
      };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },
};
