// Tool definitions and registry for TallaAgent.
// Each tool defines its schema and execution function.
// Tools reuse Phase 4 repositories — no duplicate business logic.

import type { TallaTool, ToolContext, ToolResult } from "../types.js";

// Import tools
import { getPropertyInfoTool } from "./propertyTools.js";
import { getToursTool } from "./tourTools.js";
import {
  getGuestStayTool,
  getGuestTourRequestsTool,
  getGuestMotorbikeStateTool,
  getGuestFoodOrdersTool,
  getGuestMessagesTool,
  getGuestFolioTool,
  writeGuestMessageTool,
} from "./guestStateTools.js";
import { getMenuTool } from "./menuTools.js";
import { createGuestRequestTool } from "./guestRequestTools.js";
import { requestRoomBookingTool, checkRoomAvailabilityTool } from "./bookingTools.js";
import { createHousekeepingTaskTool } from "./housekeepingTools.js";
import { createMaintenanceRequestTool } from "./maintenanceTools.js";
import { createFoodOrderTool } from "./orderTools.js";
import {
  getGuestStayStateTool,
  requestTourTool,
  requestRentalTool,
  requestHousekeepingTool,
  recordPaymentTool,
  checkInGuestTool,
  checkOutGuestTool,
  confirmBookingTool,
} from "./guestLifecycleTools.js";
import { getInventoryTool } from "./inventoryTools.js";
import { getTodayOperationsTool } from "./operationsTools.js";
import { getResortOperationsTool } from "./operationsSupabaseTool.js";
import { sendGuestEmailTool } from "./emailTools.js";
import { browserInspectPageTool, browserReadPageTool } from "./browserTools.js";
import { searchResortKnowledgeTool } from "./aiSearchTools.js";
import { sandboxWriteFileTool, sandboxReadFileTool, sandboxListFilesTool, sandboxRunAnalysisTool } from "./sandboxTools.js";
import {
  listStaffTool,
  getPayrollSnapshotTool,
  runPayrollTool,
  markPayRecordPaidTool,
  logPaymentTool,
  listPaymentsTool,
  listBookingsTool,
  listPendingRequestsTool,
  listMotorbikesTool,
  confirmTourTool,
  confirmRentalTool,
  updateMotorbikeStatusTool,
  confirmBookingByIdTool,
  listUnpaidPayRecordsTool,
} from "./staffTools.js";

// Computer tools (Phase 6)
import { computerTools } from "../../computer/tools.js";

/**
 * Get all available tools for the current context.
 * Owner/admin gets more tools than guest.
 * Computer tools are only available when enabled and for owner/admin.
 */
export function getTools(role: string | null, computerEnabled = false): TallaTool[] {
  const isOwner = role === "owner" || role === "admin";

  const tools: TallaTool[] = [
    // Read tools — available to everyone
    getPropertyInfoTool,
    getToursTool,
    getMenuTool,
    getInventoryTool,
    searchResortKnowledgeTool,
    getGuestStayTool,
    getGuestTourRequestsTool,
    getGuestMotorbikeStateTool,
    getGuestFoodOrdersTool,
    getGuestMessagesTool,
    getGuestFolioTool,
    checkRoomAvailabilityTool,
    getGuestStayStateTool,
    listMotorbikesTool,

    // Write tools — available to authenticated users
    createGuestRequestTool,
    createHousekeepingTaskTool,
    createMaintenanceRequestTool,
    createFoodOrderTool,
    requestRoomBookingTool,
    requestTourTool,
    requestRentalTool,
    requestHousekeepingTool,
    sendGuestEmailTool,
  ];

  // Owner-only tools — full admin surface (bookings, tours, rentals, staff, payroll)
  if (isOwner) {
    tools.push(getTodayOperationsTool);
    tools.push(getResortOperationsTool);
    tools.push(browserInspectPageTool);
    tools.push(browserReadPageTool);
    tools.push(writeGuestMessageTool);
    tools.push(recordPaymentTool);
    tools.push(checkInGuestTool);
    tools.push(checkOutGuestTool);
    tools.push(confirmBookingTool);
    tools.push(confirmBookingByIdTool);
    tools.push(confirmTourTool);
    tools.push(confirmRentalTool);
    tools.push(listBookingsTool);
    tools.push(listPendingRequestsTool);
    tools.push(updateMotorbikeStatusTool);
    tools.push(listStaffTool);
    tools.push(getPayrollSnapshotTool);
    tools.push(listUnpaidPayRecordsTool);
    tools.push(runPayrollTool);
    tools.push(markPayRecordPaidTool);
    tools.push(logPaymentTool);
    tools.push(listPaymentsTool);
    tools.push(sandboxWriteFileTool);
    tools.push(sandboxReadFileTool);
    tools.push(sandboxListFilesTool);
    tools.push(sandboxRunAnalysisTool);
  }

  // Computer workspace tools — owner/admin only, when enabled
  if (isOwner && computerEnabled) {
    tools.push(...computerTools);
  }

  return tools;
}

/**
 * Convert TallaTools to OpenRouter function-calling format.
 */
export function toOpenRouterTools(tools: TallaTool[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Execute a tool by name.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  computerEnabled = false,
): Promise<ToolResult> {
  // Must pass computerEnabled so owner Computer tools resolve the same way
  // the LLM tool list was built — previously this always dropped them.
  const tools = getTools(ctx.role, computerEnabled);
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }
  return tool.execute(args, ctx);
}
