// Owner/admin ops API — staff, payroll, bookings, pending requests, rentals.
// Same Supabase tables Admin managers use. Auth: owner/admin only.

import type { Env } from "../env.js";
import type { AuthContext } from "../auth/context.js";
import { requireAdmin } from "../auth/middleware.js";
import { createRequestContext, logRequest } from "../middleware/logger.js";
import {
  listStaff,
  listShifts,
  listPayRecords,
  listPayments,
  runPayroll,
  markPayRecordPaid,
  logPayment,
  getStaffPayrollSnapshot,
} from "../db/repos/staffRepo.js";
import {
  listBookings,
  listPendingRequests,
  listMotorbikes,
  confirmTourRequest,
  confirmRentalRequest,
  updateMotorbikeStatus,
} from "../db/repos/opsAdminRepo.js";
import { confirmBookingRequest } from "../db/repos/guestStateRepo.js";
import { getResortOperations } from "../db/operations.js";

export async function handleOps(
  request: Request,
  env: Env,
  auth: AuthContext,
  path: string,
): Promise<Response> {
  const ctx = createRequestContext(request, path, auth.userId, auth.tenantId);

  const adminErr = requireAdmin(auth);
  if (adminErr) {
    logRequest(ctx, adminErr.status);
    return adminErr;
  }

  try {
    // GET /api/ops/snapshot — full owner dashboard snapshot
    if (path === "/api/ops/snapshot" && request.method === "GET") {
      const [bookings, pending, staff, payroll, payments, bikes, resort] = await Promise.all([
        listBookings(env, { limit: 100 }).catch(() => []),
        listPendingRequests(env).catch(() => []),
        listStaff(env).catch(() => []),
        getStaffPayrollSnapshot(env).catch(() => ({
          activeStaff: 0,
          unpaidCount: 0,
          unpaidTotal: 0,
          unpaid: [],
        })),
        listPayments(env, { limit: 40 }).catch(() => []),
        listMotorbikes(env).catch(() => []),
        getResortOperations(env, auth.tenantId || "marina_terrace").catch(() => null),
      ]);
      logRequest(ctx, 200);
      return Response.json({
        bookings,
        pendingRequests: pending,
        staff,
        payroll,
        payments,
        motorbikes: bikes,
        resort,
      });
    }

    // ---- Staff ----
    if (path === "/api/ops/staff" && request.method === "GET") {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get("active") === "true";
      const staff = await listStaff(env, activeOnly);
      logRequest(ctx, 200);
      return Response.json({ staff });
    }

    if (path === "/api/ops/shifts" && request.method === "GET") {
      const url = new URL(request.url);
      const shifts = await listShifts(env, {
        staffId: url.searchParams.get("staffId") || undefined,
        periodStart: url.searchParams.get("from") || undefined,
        periodEnd: url.searchParams.get("to") || undefined,
      });
      logRequest(ctx, 200);
      return Response.json({ shifts });
    }

    if (path === "/api/ops/payroll" && request.method === "GET") {
      const url = new URL(request.url);
      const unpaidOnly = url.searchParams.get("unpaid") === "true";
      const [records, snapshot] = await Promise.all([
        listPayRecords(env, { unpaidOnly, limit: 100 }),
        getStaffPayrollSnapshot(env),
      ]);
      logRequest(ctx, 200);
      return Response.json({ records, snapshot });
    }

    if (path === "/api/ops/payroll/run" && request.method === "POST") {
      const body = (await request.json()) as { periodStart?: string; periodEnd?: string };
      if (!body.periodStart || !body.periodEnd) {
        logRequest(ctx, 400);
        return Response.json({ error: "periodStart and periodEnd required" }, { status: 400 });
      }
      const result = await runPayroll(env, body.periodStart, body.periodEnd);
      logRequest(ctx, 200);
      return Response.json({ result });
    }

    if (path === "/api/ops/payroll/mark-paid" && request.method === "POST") {
      const body = (await request.json()) as { payRecordId?: string; method?: string };
      if (!body.payRecordId) {
        logRequest(ctx, 400);
        return Response.json({ error: "payRecordId required" }, { status: 400 });
      }
      const result = await markPayRecordPaid(env, body.payRecordId, body.method || "cash");
      if (!result.ok) {
        logRequest(ctx, 400);
        return Response.json({ error: result.error }, { status: 400 });
      }
      logRequest(ctx, 200);
      return Response.json({ result });
    }

    if (path === "/api/ops/payments" && request.method === "GET") {
      const url = new URL(request.url);
      const direction = url.searchParams.get("direction");
      const payments = await listPayments(env, {
        direction: direction === "in" || direction === "out" ? direction : undefined,
        limit: Number(url.searchParams.get("limit") || 50) || 50,
      });
      logRequest(ctx, 200);
      return Response.json({ payments });
    }

    if (path === "/api/ops/payments" && request.method === "POST") {
      const body = (await request.json()) as {
        direction?: "in" | "out";
        category?: string;
        amount?: number;
        method?: string;
        description?: string;
        relatedId?: string;
      };
      if (!body.direction || !body.category || !body.amount || !body.method || !body.description) {
        logRequest(ctx, 400);
        return Response.json({ error: "direction, category, amount, method, description required" }, { status: 400 });
      }
      const result = await logPayment(env, {
        direction: body.direction,
        category: body.category,
        amount: body.amount,
        method: body.method,
        description: body.description,
        relatedId: body.relatedId,
      });
      if (!result.ok) {
        logRequest(ctx, 400);
        return Response.json({ error: result.error }, { status: 400 });
      }
      logRequest(ctx, 200);
      return Response.json({ result });
    }

    // ---- Bookings / pending ----
    if (path === "/api/ops/bookings" && request.method === "GET") {
      const url = new URL(request.url);
      const bookings = await listBookings(env, {
        status: url.searchParams.get("status") || undefined,
        limit: Number(url.searchParams.get("limit") || 50) || 50,
      });
      logRequest(ctx, 200);
      return Response.json({ bookings });
    }

    if (path === "/api/ops/pending" && request.method === "GET") {
      const pending = await listPendingRequests(env);
      logRequest(ctx, 200);
      return Response.json({ pending });
    }

    if (path === "/api/ops/confirm/booking" && request.method === "POST") {
      const body = (await request.json()) as { reference?: string };
      if (!body.reference) {
        logRequest(ctx, 400);
        return Response.json({ error: "reference required" }, { status: 400 });
      }
      const result = await confirmBookingRequest(env, { reference: body.reference });
      if (!result.ok) {
        logRequest(ctx, 400);
        return Response.json({ error: result.error }, { status: 400 });
      }
      logRequest(ctx, 200);
      return Response.json({ result });
    }

    if (path === "/api/ops/confirm/tour" && request.method === "POST") {
      const body = (await request.json()) as { reference?: string; requestId?: string };
      const result = await confirmTourRequest(env, body);
      if (!result.ok) {
        logRequest(ctx, 400);
        return Response.json({ error: result.error }, { status: 400 });
      }
      logRequest(ctx, 200);
      return Response.json({ result });
    }

    if (path === "/api/ops/confirm/rental" && request.method === "POST") {
      const body = (await request.json()) as { reference?: string; requestId?: string };
      const result = await confirmRentalRequest(env, body);
      if (!result.ok) {
        logRequest(ctx, 400);
        return Response.json({ error: result.error }, { status: 400 });
      }
      logRequest(ctx, 200);
      return Response.json({ result });
    }

    // ---- Motorbikes ----
    if (path === "/api/ops/motorbikes" && request.method === "GET") {
      const url = new URL(request.url);
      const bikes = await listMotorbikes(env, url.searchParams.get("available") === "true");
      logRequest(ctx, 200);
      return Response.json({ motorbikes: bikes });
    }

    if (path === "/api/ops/motorbikes/status" && request.method === "PATCH") {
      const body = (await request.json()) as {
        bikeName?: string;
        status?: "available" | "rented" | "maintenance";
      };
      if (!body.bikeName || !body.status) {
        logRequest(ctx, 400);
        return Response.json({ error: "bikeName and status required" }, { status: 400 });
      }
      const result = await updateMotorbikeStatus(env, body.bikeName, body.status);
      if (!result.ok) {
        logRequest(ctx, 400);
        return Response.json({ error: result.error }, { status: 400 });
      }
      logRequest(ctx, 200);
      return Response.json({ result });
    }

    logRequest(ctx, 404);
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error(`[ops] Error:`, err);
    logRequest(ctx, 500);
    return Response.json({ error: (err as Error).message || "Internal server error" }, { status: 500 });
  }
}
