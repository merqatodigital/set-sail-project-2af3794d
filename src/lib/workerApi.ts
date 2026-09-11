// Frontend API client for Cloudflare Worker.
// Provides typed functions for all Phase 4 operational domains.
// Replaces direct Supabase calls in React components.

import { supabase } from "./supabase";
import { talaWorkerBase, TALA_TENANT } from "./talaClient";

/**
 * Resolve the owner's Supabase session JWT. Supabase JS v2 persists the
 * session under `sb-<project-ref>-auth-token` (a JSON blob containing the
 * access token), NOT under a literal `supabase-auth-token` key, so we read it
 * from the live client rather than guessing the localStorage key. Returns ""
 * when no session is active (routes that need owner auth will then 401 as
 * intended).
 */
async function getBearerToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  } catch {
    return "";
  }
}

async function apiFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await getBearerToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    // When Guest Login is used (no Supabase session), forward the dev tenant
    // header so the Worker's TALA_DEV_MODE bypass grants owner access in staging.
    headers["X-Dev-Tenant"] = TALA_TENANT;
  }

  const res = await fetch(`${talaWorkerBase()}${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ============================================================
// TYPES
// ============================================================

export interface PropertySetting {
  id: string;
  tenantId: string;
  category: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface HousekeepingTask {
  id: string;
  tenantId: string;
  room: string;
  area: string;
  taskType: string;
  status: string;
  priority: string;
  assignedTo: string;
  notes: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface MaintenanceRequest {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  location: string;
  issueType: string;
  priority: string;
  status: string;
  assignedTo: string;
  notes: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface MenuItem {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  category: string;
  price: number;
  foodCost: number;
  inventoryCount: number;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface FoodOrderItem {
  id: string;
  tenantId: string;
  orderId: string;
  menuItemId: string;
  name: string;
  quantity: number;
  price: number;
  foodCost: number;
  createdAt: string;
}

export interface FoodOrder {
  id: string;
  tenantId: string;
  reference: string;
  guestName: string;
  guestPhone: string;
  items: FoodOrderItem[];
  total: number;
  totalCost: number;
  status: string;
  notes: string;
  createdAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  tenantId: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  reorderThreshold: number;
  unitCost: number;
  notes: string;
  updatedAt: string;
}

export interface TalaTask {
  id: string;
  tenantId: string;
  title: string;
  due: string;
  status: string;
  category: string;
  createdAt: string;
}

export interface TalaLead {
  id: string;
  tenantId: string;
  name: string;
  contact: string;
  note: string;
  source: string;
  sourceUrl: string;
  createdAt: string;
}

export interface TalaGoal {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  status: string;
  targetDate: string;
  createdAt: string;
}

export interface TalaBriefing {
  id: string;
  tenantId: string;
  briefDate: string;
  summary: string;
  highlights: string[];
  generatedAt: string;
  whatsappSent: boolean;
}

export interface TalaWin {
  id: string;
  tenantId: string;
  briefDate: string;
  text: string;
  createdAt: string;
}

export interface GuestRequest {
  id: string;
  tenantId: string;
  type: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  tourName: string;
  tourDate: string;
  bikeName: string;
  startDate: string;
  endDate: string;
  guests: number;
  amount: number;
  notes: string;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// API CLIENT
// ============================================================

export const api = {
  // ---- Property Settings ----
  settings: {
    list: () => apiFetch<{ settings: PropertySetting[] }>("/api/settings"),
    listByCategory: (category: string) =>
      apiFetch<{ settings: PropertySetting[] }>(`/api/settings/${category}`),
    upsert: (data: { category: string; key: string; value: string }) =>
      apiFetch<{ setting: PropertySetting }>("/api/settings", { method: "PUT", body: data }),
    upsertBatch: (settings: Array<{ category: string; key: string; value: string }>) =>
      apiFetch<{ ok: boolean }>("/api/settings/batch", { method: "PUT", body: { settings } }),
    delete: (key: string) =>
      apiFetch<{ ok: boolean }>(`/api/settings/${key}`, { method: "DELETE" }),
  },

  // ---- Guest Requests ----
  requests: {
    create: (data: {
      type: string;
      guestName: string;
      guestPhone?: string;
      guestEmail?: string;
      roomType?: string;
      checkIn?: string;
      checkOut?: string;
      tourName?: string;
      tourDate?: string;
      bikeName?: string;
      startDate?: string;
      endDate?: string;
      guests?: number;
      amount?: number;
      notes?: string;
    }) => apiFetch<{ request: GuestRequest }>("/api/requests", { method: "POST", body: data }),
    list: (filters?: { type?: string; status?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.type) params.set("type", filters.type);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ requests: GuestRequest[] }>(`/api/requests${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => apiFetch<{ request: GuestRequest }>(`/api/requests/${id}`),
    updateStatus: (id: string, status: string) =>
      apiFetch<{ request: GuestRequest }>(`/api/requests/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
  },

  // ---- Tours ----
  tours: {
    listActive: () => apiFetch<{ tours: unknown[] }>("/api/tours/active"),
    list: () => apiFetch<{ tours: unknown[] }>("/api/tours"),
    get: (id: string) => apiFetch<{ tour: unknown }>(`/api/tours/${id}`),
  },

  // ---- Housekeeping ----
  housekeeping: {
    create: (data: {
      room: string;
      area?: string;
      taskType?: string;
      priority?: string;
      assignedTo?: string;
      notes?: string;
    }) => apiFetch<{ task: HousekeepingTask }>("/api/housekeeping", { method: "POST", body: data }),
    list: (filters?: { status?: string; room?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.room) params.set("room", filters.room);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ tasks: HousekeepingTask[] }>(`/api/housekeeping${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => apiFetch<{ task: HousekeepingTask }>(`/api/housekeeping/${id}`),
    updateStatus: (id: string, status: string) =>
      apiFetch<{ task: HousekeepingTask }>(`/api/housekeeping/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    delete: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/housekeeping/${id}`, { method: "DELETE" }),
  },

  // ---- Maintenance ----
  maintenance: {
    create: (data: {
      title: string;
      description?: string;
      location?: string;
      issueType?: string;
      priority?: string;
      assignedTo?: string;
      notes?: string;
    }) => apiFetch<{ request: MaintenanceRequest }>("/api/maintenance", {
      method: "POST",
      body: data,
    }),
    list: (filters?: { status?: string; priority?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.priority) params.set("priority", filters.priority);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ requests: MaintenanceRequest[] }>(`/api/maintenance${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => apiFetch<{ request: MaintenanceRequest }>(`/api/maintenance/${id}`),
    updateStatus: (id: string, status: string) =>
      apiFetch<{ request: MaintenanceRequest }>(`/api/maintenance/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    delete: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/maintenance/${id}`, { method: "DELETE" }),
  },

  // ---- Menu Items ----
  menu: {
    list: (options?: { activeOnly?: boolean; category?: string }) => {
      const params = new URLSearchParams();
      if (options?.activeOnly === false) params.set("active", "false");
      if (options?.category) params.set("category", options.category);
      const qs = params.toString();
      return apiFetch<{ items: MenuItem[] }>(`/api/menu${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => apiFetch<{ item: MenuItem }>(`/api/menu/${id}`),
    create: (data: {
      name: string;
      description?: string;
      category?: string;
      price: number;
      foodCost?: number;
      inventoryCount?: number;
      active?: boolean;
      sortOrder?: number;
    }) => apiFetch<{ item: MenuItem }>("/api/menu", { method: "POST", body: data }),
    update: (id: string, data: Partial<{
      name: string;
      description: string;
      category: string;
      price: number;
      foodCost: number;
      inventoryCount: number;
      active: boolean;
      sortOrder: number;
    }>) => apiFetch<{ item: MenuItem }>(`/api/menu/${id}`, { method: "PUT", body: data }),
    delete: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/menu/${id}`, { method: "DELETE" }),
  },

  // ---- Food Orders ----
  orders: {
    create: (data: {
      guestName: string;
      guestPhone?: string;
      notes?: string;
      items: Array<{ menuItemId: string; quantity: number; specialInstructions?: string }>;
    }) => apiFetch<{ order: FoodOrder }>("/api/orders", { method: "POST", body: data }),
    list: (filters?: { status?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ orders: FoodOrder[] }>(`/api/orders${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => apiFetch<{ order: FoodOrder }>(`/api/orders/${id}`),
    updateStatus: (id: string, status: string) =>
      apiFetch<{ order: FoodOrder }>(`/api/orders/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
  },

  // ---- Inventory ----
  inventory: {
    list: (options?: { category?: string; lowStock?: boolean }) => {
      const params = new URLSearchParams();
      if (options?.category) params.set("category", options.category);
      if (options?.lowStock) params.set("lowStock", "true");
      const qs = params.toString();
      return apiFetch<{ items: InventoryItem[] }>(`/api/inventory${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => apiFetch<{ item: InventoryItem }>(`/api/inventory/${id}`),
    upsert: (data: {
      id?: string;
      name: string;
      category?: string;
      unit?: string;
      quantity: number;
      reorderThreshold?: number;
      unitCost?: number;
      notes?: string;
    }) => apiFetch<{ item: InventoryItem }>("/api/inventory", { method: "POST", body: data }),
    bulkUpsert: (items: Array<{
      id?: string;
      name: string;
      category?: string;
      unit?: string;
      quantity: number;
      reorderThreshold?: number;
      unitCost?: number;
      notes?: string;
    }>) => apiFetch<{ ok: boolean; count: number }>("/api/inventory/bulk", {
      method: "PUT",
      body: { items },
    }),
    adjust: (id: string, adjustment: number) =>
      apiFetch<{ item: InventoryItem }>(`/api/inventory/${id}/adjust`, {
        method: "PATCH",
        body: { adjustment },
      }),
    delete: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/inventory/${id}`, { method: "DELETE" }),
  },

  // ---- Talla Chat ----
  talla: {
    chat: (data: {
      message: string;
      tenantId?: string;
      userId?: string;
      role?: string;
      guestName?: string;
      guestRoom?: string;
    }) => apiFetch<{ content: string | null; model?: string; usage?: unknown }>("/api/talla/chat", {
      method: "POST",
      body: data,
    }),
  },

  // ---- Talla Tasks ----
  tallaTasks: {
    create: (data: { title: string; due?: string; category?: string }) =>
      apiFetch<{ task: TalaTask }>("/api/talla/tasks", { method: "POST", body: data }),
    list: (filters?: { status?: string; category?: string }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.category) params.set("category", filters.category);
      const qs = params.toString();
      return apiFetch<{ tasks: TalaTask[] }>(`/api/talla/tasks${qs ? `?${qs}` : ""}`);
    },
    updateStatus: (id: string, status: string) =>
      apiFetch<{ task: TalaTask }>(`/api/talla/tasks/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
  },

  // ---- Talla Leads ----
  tallaLeads: {
    create: (data: { name: string; contact?: string; note?: string; source?: string }) =>
      apiFetch<{ lead: TalaLead }>("/api/talla/leads", { method: "POST", body: data }),
    list: (filters?: { source?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.source) params.set("source", filters.source);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ leads: TalaLead[] }>(`/api/talla/leads${qs ? `?${qs}` : ""}`);
    },
  },

  // ---- Talla Goals ----
  tallaGoals: {
    create: (data: { title: string; description?: string; targetDate?: string }) =>
      apiFetch<{ goal: TalaGoal }>("/api/talla/goals", { method: "POST", body: data }),
    list: (filters?: { status?: string }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      const qs = params.toString();
      return apiFetch<{ goals: TalaGoal[] }>(`/api/talla/goals${qs ? `?${qs}` : ""}`);
    },
    updateStatus: (id: string, status: string) =>
      apiFetch<{ goal: TalaGoal }>(`/api/talla/goals/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
  },

  // ---- Talla Briefings ----
  tallaBriefings: {
    create: (data: { briefDate: string; summary: string; highlights?: string[] }) =>
      apiFetch<{ briefing: TalaBriefing }>("/api/talla/briefings", { method: "POST", body: data }),
    list: (filters?: { limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ briefings: TalaBriefing[] }>(`/api/talla/briefings${qs ? `?${qs}` : ""}`);
    },
    markWhatsappSent: (id: string) =>
      apiFetch<{ briefing: TalaBriefing }>(`/api/talla/briefings/${id}/sent`, {
        method: "PATCH",
      }),
  },

  // ---- Talla Wins ----
  tallaWins: {
    create: (data: { briefDate: string; text: string }) =>
      apiFetch<{ win: TalaWin }>("/api/talla/wins", { method: "POST", body: data }),
    list: (filters?: { limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ wins: TalaWin[] }>(`/api/talla/wins${qs ? `?${qs}` : ""}`);
    },
  },

  // ---- Owner Ops (staff / payroll / bookings / rentals) ----
  // Same Supabase tables Admin managers use; agent tools share this surface.
  ops: {
    snapshot: () =>
      apiFetch<{
        bookings: unknown[];
        pendingRequests: unknown[];
        staff: unknown[];
        payroll: {
          activeStaff: number;
          unpaidCount: number;
          unpaidTotal: number;
          unpaid: unknown[];
        };
        payments: unknown[];
        motorbikes: unknown[];
        resort: unknown;
      }>("/api/ops/snapshot"),
    staff: (activeOnly?: boolean) =>
      apiFetch<{ staff: unknown[] }>(
        `/api/ops/staff${activeOnly ? "?active=true" : ""}`,
      ),
    shifts: (filters?: { staffId?: string; from?: string; to?: string }) => {
      const params = new URLSearchParams();
      if (filters?.staffId) params.set("staffId", filters.staffId);
      if (filters?.from) params.set("from", filters.from);
      if (filters?.to) params.set("to", filters.to);
      const qs = params.toString();
      return apiFetch<{ shifts: unknown[] }>(`/api/ops/shifts${qs ? `?${qs}` : ""}`);
    },
    payroll: (unpaidOnly?: boolean) =>
      apiFetch<{ records: unknown[]; snapshot: unknown }>(
        `/api/ops/payroll${unpaidOnly ? "?unpaid=true" : ""}`,
      ),
    runPayroll: (periodStart: string, periodEnd: string) =>
      apiFetch<{ result: unknown }>("/api/ops/payroll/run", {
        method: "POST",
        body: { periodStart, periodEnd },
      }),
    markPayRecordPaid: (payRecordId: string, method: string) =>
      apiFetch<{ result: unknown }>("/api/ops/payroll/mark-paid", {
        method: "POST",
        body: { payRecordId, method },
      }),
    payments: (filters?: { direction?: "in" | "out"; limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.direction) params.set("direction", filters.direction);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ payments: unknown[] }>(`/api/ops/payments${qs ? `?${qs}` : ""}`);
    },
    logPayment: (data: {
      direction: "in" | "out";
      category: string;
      amount: number;
      method: string;
      description: string;
      relatedId?: string;
    }) => apiFetch<{ result: unknown }>("/api/ops/payments", { method: "POST", body: data }),
    bookings: (filters?: { status?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiFetch<{ bookings: unknown[] }>(`/api/ops/bookings${qs ? `?${qs}` : ""}`);
    },
    pending: () => apiFetch<{ pending: unknown[] }>("/api/ops/pending"),
    confirmBooking: (reference: string) =>
      apiFetch<{ result: unknown }>("/api/ops/confirm/booking", {
        method: "POST",
        body: { reference },
      }),
    confirmTour: (data: { reference?: string; requestId?: string }) =>
      apiFetch<{ result: unknown }>("/api/ops/confirm/tour", { method: "POST", body: data }),
    confirmRental: (data: { reference?: string; requestId?: string }) =>
      apiFetch<{ result: unknown }>("/api/ops/confirm/rental", {
        method: "POST",
        body: data,
      }),
    motorbikes: (availableOnly?: boolean) =>
      apiFetch<{ motorbikes: unknown[] }>(
        `/api/ops/motorbikes${availableOnly ? "?available=true" : ""}`,
      ),
    setMotorbikeStatus: (
      bikeName: string,
      status: "available" | "rented" | "maintenance",
    ) =>
      apiFetch<{ result: unknown }>("/api/ops/motorbikes/status", {
        method: "PATCH",
        body: { bikeName, status },
      }),
  },
};
