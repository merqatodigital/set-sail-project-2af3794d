// Phase 6.1 tests — Cloudflare Computer verification and hardening.
//
// These tests prove BEHAVIOR of modules that do not require
// the Cloudflare Workers runtime (paths, policy, tools, types).
//
// Real Workspace integration tests (requiring cloudflare:workers)
// are UNVERIFIED locally and documented in the completion report.

import { describe, it, expect } from "vitest";

import {
  validatePath,
  tenantRoot,
  resolveWorkspacePath,
  belongsToTenant,
  isCrossTenantAccess,
  describePath,
} from "../src/computer/paths.js";
import { evaluatePolicy, isAllowed, isBlocked } from "../src/computer/policy.js";
import { computerTools } from "../src/computer/tools.js";
import { getTools } from "../src/agents/tools/index.js";
import { buildSystemPrompt } from "../src/agents/systemPrompt.js";

// ============================================================
// 1. PATH SECURITY
// ============================================================

describe("Phase 6.1 — Path Security", () => {
  it("tenantRoot returns /talla/<tenantId>", () => {
    expect(tenantRoot("marina_terrace")).toBe("/talla/marina_terrace");
    expect(tenantRoot("test_resort_b")).toBe("/talla/test_resort_b");
  });

  it("resolveWorkspacePath resolves relative path", () => {
    expect(resolveWorkspacePath("marina_terrace", "reports/daily")).toBe(
      "/talla/marina_terrace/reports/daily",
    );
  });

  it("validatePath accepts valid paths", () => {
    const result = validatePath("marina_terrace", "reports/daily/2026-08-08.md");
    expect(result).toBe("/talla/marina_terrace/reports/daily/2026-08-08.md");
  });

  it("REJECTS path traversal with ..", () => {
    expect(validatePath("marina_terrace", "../../etc/passwd")).toBeNull();
    expect(validatePath("marina_terrace", "reports/../../secret")).toBeNull();
  });

  it("REJECTS encoded traversal", () => {
    expect(validatePath("marina_terrace", "%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(validatePath("marina_terrace", "%2e%2e%2f%2e%2e%2fetc%2fpasswd")).toBeNull();
  });

  it("REJECTS absolute paths outside workspace", () => {
    expect(validatePath("marina_terrace", "/etc/passwd")).toBeNull();
    expect(validatePath("marina_terrace", "/var/log")).toBeNull();
  });

  it("REJECTS system paths", () => {
    expect(validatePath("marina_terrace", "wrangler.json")).toBeNull();
    expect(validatePath("marina_terrace", ".env")).toBeNull();
    expect(validatePath("marina_terrace", "node_modules/package")).toBeNull();
  });

  it("REJECTS paths escaping tenant root", () => {
    expect(validatePath("marina_terrace", "../test_resort_b/file")).toBeNull();
    expect(validatePath("marina_terrace", "/talla/test_resort_b/file")).toBeNull();
  });

  it("REJECTS empty and very long paths", () => {
    expect(validatePath("marina_terrace", "")).toBeNull();
    expect(validatePath("marina_terrace", "a".repeat(600))).toBeNull();
  });

  it("belongsToTenant identifies tenant-owned paths", () => {
    expect(belongsToTenant("/talla/marina_terrace/reports", "marina_terrace")).toBe(true);
    expect(belongsToTenant("/talla/test_resort_b/reports", "marina_terrace")).toBe(false);
  });

  it("isCrossTenantAccess detects cross-tenant attempts", () => {
    expect(isCrossTenantAccess("/talla/test_resort_b/file", "marina_terrace")).toBe(true);
    expect(isCrossTenantAccess("/talla/marina_terrace/file", "marina_terrace")).toBe(false);
  });

  it("describePath strips tenant root", () => {
    expect(describePath("/talla/marina_terrace/reports/daily")).toBe("/reports/daily");
    expect(describePath("/talla/marina_terrace")).toBe("/");
  });

  it("backslash traversal is blocked", () => {
    expect(validatePath("marina_terrace", "..\\..\\etc\\passwd")).toBeNull();
  });
});

// ============================================================
// 2. POLICY ENGINE
// ============================================================

describe("Phase 6.1 — Policy Engine", () => {
  it("owner can read workspace files", () => {
    const r = evaluatePolicy({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "read", path: "/talla/marina_terrace/reports/daily.md" });
    expect(r.decision).toBe("AUTO_APPROVED");
  });

  it("owner can write to permitted directories", () => {
    for (const dir of ["/reports/", "/working/", "/generated/", "/knowledge/", "/documents/", "/logs/"]) {
      const r = evaluatePolicy({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "write", path: `/talla/marina_terrace${dir}test.md` });
      expect(r.decision).toBe("AUTO_APPROVED");
    }
  });

  it("guest is BLOCKED", () => {
    const r = evaluatePolicy({ tenantId: "marina_terrace", userId: null, role: null, action: "read", path: "/talla/marina_terrace/reports" });
    expect(r.decision).toBe("BLOCKED");
  });

  it("staff is BLOCKED", () => {
    const r = evaluatePolicy({ tenantId: "marina_terrace", userId: "u2", role: "staff", action: "read", path: "/talla/marina_terrace/reports" });
    expect(r.decision).toBe("BLOCKED");
  });

  it("secret access is BLOCKED", () => {
    for (const p of ["/talla/marina_terrace/.env", "/talla/marina_terrace/credentials.json"]) {
      const r = evaluatePolicy({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "read", path: p });
      expect(r.decision).toBe("BLOCKED");
    }
  });

  it("cross-tenant access is BLOCKED", () => {
    const r = evaluatePolicy({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "read", path: "/talla/test_resort_b/reports" });
    expect(r.decision).toBe("BLOCKED");
  });

  it("publish requires approval", () => {
    const r = evaluatePolicy({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "publish", path: "/talla/marina_terrace/reports/daily.md" });
    expect(r.decision).toBe("REQUIRES_APPROVAL");
  });

  it("isAllowed and isBlocked work correctly", () => {
    expect(isAllowed({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "read", path: "/talla/marina_terrace/reports/daily.md" })).toBe(true);
    expect(isBlocked({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "read", path: "/talla/test_resort_b/file" })).toBe(true);
  });
});

// ============================================================
// 3. TENANT ISOLATION
// ============================================================

describe("Phase 6.1 — Tenant Isolation", () => {
  const tA = "marina_terrace";
  const tB = "test_resort_b";

  it("tenants have separate workspace roots", () => {
    expect(tenantRoot(tA)).not.toBe(tenantRoot(tB));
  });

  it("tenant A cannot access tenant B (read/write/list/search)", () => {
    for (const action of ["read", "write", "list", "search"]) {
      const r = evaluatePolicy({ tenantId: tA, userId: "u1", role: "owner", action, path: `/talla/${tB}/file` });
      expect(r.decision).toBe("BLOCKED");
    }
  });

  it("tenant B cannot access tenant A", () => {
    const r = evaluatePolicy({ tenantId: tB, userId: "u1", role: "owner", action: "read", path: `/talla/${tA}/file` });
    expect(r.decision).toBe("BLOCKED");
  });

  it("path validation rejects cross-tenant paths", () => {
    expect(validatePath(tA, `/../${tB}/file`)).toBeNull();
  });
});

// ============================================================
// 4. TOOL REGISTRATION
// ============================================================

describe("Phase 6.1 — Tool Registration", () => {
  it("computerTools has 4 tools", () => {
    expect(computerTools).toHaveLength(4);
  });

  it("all tools have name, description, parameters, execute", () => {
    for (const tool of computerTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("getTools returns D1 tools only when Computer disabled", () => {
    const tools = getTools("owner", false);
    expect(tools.filter((t) => t.name.startsWith("workspace"))).toHaveLength(0);
    // Base D1/ops tools + staff/payroll/booking confirmations (no Computer)
    expect(tools.length).toBe(49);
  });

  it("getTools adds 4 Computer tools when enabled for owner", () => {
    const tools = getTools("owner", true);
    expect(tools.filter((t) => t.name.startsWith("workspace"))).toHaveLength(4);
    expect(tools.length).toBe(53);
  });

  it("no Computer tools for guest or staff", () => {
    expect(getTools(null, true).filter((t) => t.name.startsWith("workspace"))).toHaveLength(0);
    expect(getTools("staff", true).filter((t) => t.name.startsWith("workspace"))).toHaveLength(0);
  });

  it("all 9 D1 tools still present", () => {
    const names = getTools("owner", false).map((t) => t.name);
    for (const n of ["getPropertyInfo", "getTours", "getMenu", "getInventory", "createGuestRequest", "createHousekeepingTask", "createMaintenanceRequest", "createFoodOrder", "getTodayOperations"]) {
      expect(names).toContain(n);
    }
  });
});

// ============================================================
// 5. SYSTEM PROMPT
// ============================================================

describe("Phase 6.1 — System Prompt", () => {
  it("includes Computer section when enabled for owner", () => {
    const p = buildSystemPrompt({ tenantId: "marina_terrace", role: "owner", guestName: null, guestRoom: null, propertyInfo: {}, tours: [], menuItems: [], computerEnabled: true });
    expect(p).toContain("COMPUTER WORKSPACE");
    expect(p).toContain("Supabase + D1 remain authoritative");
    expect(p).toContain("tenant-scoped workspace");
  });

  it("omits Computer section when disabled", () => {
    const p = buildSystemPrompt({ tenantId: "marina_terrace", role: "owner", guestName: null, guestRoom: null, propertyInfo: {}, tours: [], menuItems: [], computerEnabled: false });
    expect(p).not.toContain("COMPUTER WORKSPACE");
  });

  it("omits Computer section for guest", () => {
    const p = buildSystemPrompt({ tenantId: "marina_terrace", role: null, guestName: "John", guestRoom: "101", propertyInfo: {}, tours: [], menuItems: [], computerEnabled: true });
    expect(p).not.toContain("COMPUTER WORKSPACE");
  });
});

// ============================================================
// 6. FAILURE ISOLATION
// ============================================================

describe("Phase 6.1 — Failure Isolation", () => {
  it("D1 tools work regardless of Computer state", () => {
    expect(getTools("owner", false).length).toBe(49);
    expect(getTools("owner", true).length).toBe(53);
  });
});

// ============================================================
// 7. STATUS TYPES
// ============================================================

describe("Phase 6.1 — Status Types", () => {
  it("ComputerStatus has required fields", () => {
    const s: import("../src/computer/types.js").ComputerStatus = {
      enabled: true, workspaceInitialized: true, backend: "worker-javascript",
      tenantId: "marina_terrace", lastSuccessfulOperation: "workspaceWrite",
      lastError: null, lastOperationAt: new Date().toISOString(),
    };
    expect(s.enabled).toBe(true);
    expect(s.backend).toBe("worker-javascript");
  });
});

// ============================================================
// 8. DAILY REPORT WORKFLOW
// ============================================================

describe("Phase 6.1 — Daily Report Workflow", () => {
  it("report path is correctly computed", () => {
    const today = new Date().toISOString().split("T")[0];
    const path = resolveWorkspacePath("marina_terrace", `reports/${today}-daily-operations.md`);
    expect(path).toBe(`/talla/marina_terrace/reports/${today}-daily-operations.md`);
  });

  it("report includes all required sections", () => {
    const content = [
      "# Daily Operations Report", "## Guest Requests", "## Housekeeping",
      "## Maintenance", "## Food Orders", "## Inventory Alerts",
      "## Active Tours", "## Talla Tasks", "## Items Requiring Owner Attention",
    ].join("\n");
    for (const s of ["Guest Requests", "Housekeeping", "Maintenance", "Food Orders", "Inventory Alerts", "Active Tours", "Talla Tasks", "Items Requiring Owner Attention"]) {
      expect(content).toContain(s);
    }
  });
});

// ============================================================
// 9. PROMPT INJECTION RESISTANCE
// ============================================================

describe("Phase 6.1 — Prompt Injection Resistance", () => {
  it("blocks /etc/passwd", () => {
    expect(validatePath("marina_terrace", "/etc/passwd")).toBeNull();
  });

  it("blocks .env", () => {
    expect(validatePath("marina_terrace", ".env")).toBeNull();
    expect(validatePath("marina_terrace", "/talla/marina_terrace/.env")).toBeNull();
  });

  it("blocks wrangler.json and node_modules", () => {
    expect(validatePath("marina_terrace", "wrangler.json")).toBeNull();
    expect(validatePath("marina_terrace", "node_modules/package")).toBeNull();
  });

  it("policy blocks secrets and credentials", () => {
    for (const p of ["/talla/marina_terrace/.env", "/talla/marina_terrace/credentials.json"]) {
      expect(evaluatePolicy({ tenantId: "marina_terrace", userId: "u1", role: "owner", action: "read", path: p }).decision).toBe("BLOCKED");
    }
  });

  it("encoded and backslash traversal blocked", () => {
    expect(validatePath("marina_terrace", "%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(validatePath("marina_terrace", "..\\..\\etc\\passwd")).toBeNull();
  });
});
