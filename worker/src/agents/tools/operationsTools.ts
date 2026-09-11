// Today operations tool — aggregated operational snapshot for owner/admin.
// Reads from multiple Phase 4 repos to provide a concise daily briefing.

import type { TallaTool } from "../types.js";
import { listGuestRequests } from "../../db/repos/guestRequestRepo.js";
import { listHousekeepingTasks } from "../../db/repos/housekeepingRepo.js";
import { listMaintenanceRequests } from "../../db/repos/maintenanceRepo.js";
import { listOrders } from "../../db/repos/foodOrderRepo.js";
import { listInventory } from "../../db/repos/inventoryRepo.js";
import { listTasks } from "../../db/repos/tallaOpsRepo.js";
import { getStaffPayrollSnapshot } from "../../db/repos/staffRepo.js";
import { listPendingRequests, listMotorbikes } from "../../db/repos/opsAdminRepo.js";
import { getResortOperations } from "../../db/operations.js";

export const getTodayOperationsTool: TallaTool = {
  name: "getTodayOperations",
  description:
    "Get a summary of today's resort operations: arrivals/departures, pending booking/tour/rental requests, housekeeping, maintenance, food orders, inventory alerts, unpaid payroll, bike fleet, and TALA tasks. Use when the owner asks what needs attention today. OWNER/ADMIN ONLY.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (_args, ctx) => {
    try {
      const [
        guestRequests,
        housekeepingTasks,
        maintenanceRequests,
        foodOrders,
        lowStockItems,
        pendingTasks,
        payroll,
        pendingOps,
        bikes,
        resortOps,
      ] = await Promise.all([
        listGuestRequests(ctx.db, ctx.tenantId, { status: "pending" }).catch(() => []),
        listHousekeepingTasks(ctx.db, ctx.tenantId, { status: "pending" }).catch(() => []),
        listMaintenanceRequests(ctx.db, ctx.tenantId, { status: "pending" }).catch(() => []),
        listOrders(ctx.db, ctx.tenantId, { status: "pending" }).catch(() => []),
        listInventory(ctx.db, ctx.tenantId, { lowStock: true }).catch(() => []),
        listTasks(ctx.db, ctx.tenantId, { status: "pending" }).catch(() => []),
        getStaffPayrollSnapshot(ctx.env as never).catch(() => ({
          activeStaff: 0,
          unpaidCount: 0,
          unpaidTotal: 0,
          unpaid: [],
        })),
        listPendingRequests(ctx.env as never).catch(() => []),
        listMotorbikes(ctx.env as never).catch(() => []),
        getResortOperations(ctx.env as never, ctx.tenantId).catch(() => null),
      ]);

      const availableBikes = bikes.filter((b) => b.active && b.status === "available").length;
      const rentedBikes = bikes.filter((b) => b.status === "rented").length;
      const maintenanceBikes = bikes.filter((b) => b.status === "maintenance").length;

      return {
        success: true,
        data: {
          summary: {
            inHouseGuests: resortOps?.inHouseCount ?? 0,
            arrivalsTomorrow: resortOps?.arrivalsTomorrow?.length ?? 0,
            departuresTomorrow: resortOps?.departuresTomorrow?.length ?? 0,
            pendingBookingRequests: pendingOps.filter((r) => r.kind === "booking").length,
            pendingTourRequests: pendingOps.filter((r) => r.kind === "tour").length,
            pendingRentalRequests: pendingOps.filter((r) => r.kind === "rental").length,
            pendingGuestRequests: guestRequests.length,
            pendingHousekeeping: housekeepingTasks.length,
            pendingMaintenance: maintenanceRequests.length,
            pendingFoodOrders: foodOrders.length,
            lowStockAlerts: lowStockItems.length,
            pendingTasks: pendingTasks.length,
            activeStaff: payroll.activeStaff,
            unpaidPayroll: payroll.unpaidTotal,
            unpaidPayRecords: payroll.unpaidCount,
            bikesAvailable: availableBikes,
            bikesRented: rentedBikes,
            bikesMaintenance: maintenanceBikes,
          },
          arrivalsTomorrow: (resortOps?.arrivalsTomorrow ?? []).slice(0, 10).map((b) => ({
            reference: b.reference,
            guestName: b.guestName,
            roomType: b.roomType,
            checkIn: b.checkIn,
            outstandingBalance: b.outstandingBalance,
          })),
          departuresTomorrow: (resortOps?.departuresTomorrow ?? []).slice(0, 10).map((b) => ({
            reference: b.reference,
            guestName: b.guestName,
            roomType: b.roomType,
            checkOut: b.checkOut,
            outstandingBalance: b.outstandingBalance,
          })),
          pendingOpsRequests: pendingOps.slice(0, 15),
          unpaidPayroll: payroll.unpaid.slice(0, 10),
          guestRequests: guestRequests.slice(0, 10).map((r) => ({
            id: r.id,
            type: r.type,
            guestName: r.guestName,
            status: r.status,
            createdAt: r.createdAt,
          })),
          housekeepingTasks: housekeepingTasks.slice(0, 10).map((t) => ({
            id: t.id,
            room: t.room,
            taskType: t.taskType,
            priority: t.priority,
            status: t.status,
          })),
          maintenanceRequests: maintenanceRequests.slice(0, 10).map((r) => ({
            id: r.id,
            title: r.title,
            location: r.location,
            priority: r.priority,
            status: r.status,
          })),
          foodOrders: foodOrders.slice(0, 10).map((o) => ({
            id: o.id,
            reference: o.reference,
            guestName: o.guestName,
            total: o.total,
            status: o.status,
          })),
          lowStockAlerts: lowStockItems.slice(0, 10).map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            reorderThreshold: i.reorderThreshold,
          })),
          pendingTasks: pendingTasks.slice(0, 10).map((t) => ({
            id: t.id,
            title: t.title,
            category: t.category,
            due: t.due,
          })),
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};
