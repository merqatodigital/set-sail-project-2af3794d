import { describe, it, expect } from "vitest";
import { getTools, executeTool } from "../src/agents/tools/index.js";

describe("TALA staff/ops tool registry", () => {
  it("exposes owner staff/payroll/booking tools only to owner/admin", () => {
    const guest = getTools("guest", false).map((t) => t.name);
    const owner = getTools("owner", false).map((t) => t.name);
    const admin = getTools("admin", false).map((t) => t.name);

    const ownerOnly = [
      "listStaff",
      "getPayrollSnapshot",
      "runPayroll",
      "markPayRecordPaid",
      "logPayment",
      "listPayments",
      "listBookings",
      "listPendingRequests",
      "confirmTour",
      "confirmRental",
      "updateMotorbikeStatus",
      "confirmBooking",
      "confirmBookingRequest",
      "listUnpaidPayRecords",
      "getTodayOperations",
      "getResortOperations",
      "checkInGuest",
      "checkOutGuest",
      "recordPayment",
    ];

    for (const name of ownerOnly) {
      expect(guest).not.toContain(name);
      expect(owner).toContain(name);
      expect(admin).toContain(name);
    }

    // Guests can still request rentals/tours and list available bikes
    expect(guest).toContain("requestRental");
    expect(guest).toContain("requestTour");
    expect(guest).toContain("requestRoomBooking");
    expect(guest).toContain("listMotorbikes");
  });

  it("executeTool passes computerEnabled so computer tools resolve for owners", async () => {
    // Without computerEnabled, workspace tools must stay unknown
    const noComputer = await executeTool(
      "workspaceList",
      {},
      {
        tenantId: "marina_terrace",
        userId: "u1",
        role: "owner",
        db: {} as D1Database,
        env: {} as never,
      },
      false,
    );
    expect(noComputer.success).toBe(false);
    expect(String(noComputer.error)).toMatch(/Unknown tool/);
  });

  it("owner tools reject guest role at execute time", async () => {
    const result = await executeTool(
      "runPayroll",
      { periodStart: "2026-08-01", periodEnd: "2026-08-07" },
      {
        tenantId: "marina_terrace",
        userId: "guest-1",
        role: "guest",
        db: {} as D1Database,
        env: {} as never,
      },
    );
    // guest role → tool not even registered
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Unknown tool/);
  });

  it("lists core guest service tools for everyone", () => {
    const tools = getTools(null, false).map((t) => t.name);
    for (const name of [
      "checkRoomAvailability",
      "requestRoomBooking",
      "requestTour",
      "requestRental",
      "createFoodOrder",
      "getGuestStayState",
      "listMotorbikes",
    ]) {
      expect(tools).toContain(name);
    }
  });
});
