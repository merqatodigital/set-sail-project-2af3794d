import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Bell,
  Bot,
  CalendarCheck,
  ChefHat,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  ExternalLink,
  Loader2,
  MessageCircle,
  Package,
  Sparkle,
  Sunrise,
  Users,
  Wrench,
} from "lucide-react";
import { useCms } from "@/context/CmsContext";
import { PageHeader } from "../shared/PageHeader";
import { formatPHP } from "../ops/opsUtils";
import { useOperations } from "../ops/useOperations";
import { usePortalOps } from "../ops/usePortalOps";
import { computeBriefing } from "@/components/tala/buildTalaBriefing";
import { useTallaStatus } from "@/hooks/useTallaStatus";
import { fetchLatestBriefing, TALLA_TENANT } from "@/lib/tallaCloud";
import {
  useFoodOrders,
  useGuestRequests,
  useHousekeepingTasks,
  useMaintenanceRequests,
} from "@/lib/workerHooks";
import { supabase, isSupabaseConnected } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Owner command center. Every number below comes from live data already in
// the app (operations tables, the Cloudflare Worker ops endpoints, the TALA
// health probe and tala_audit_log). Nothing is invented or hard-coded.
// ---------------------------------------------------------------------------

const INK = "#26221C";
const GOLD = "#C6A15B";

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Owner-facing briefing text from the Cloudflare daily-briefing artifact.
 * We ONLY accept content that is explicitly delimited as the final,
 * owner-facing brief. Anything else (planning notes, tool traces,
 * observations, reasoning) is discarded and the caller falls back to the
 * deterministic computed brief — we never try to guess.
 */
const OWNER_MARKERS = [
  /^#{0,3}\s*owner\s+brief(ing)?\s*:?\s*$/im,
  /^#{0,3}\s*morning\s+brief(ing)?\s*:?\s*$/im,
  /^#{0,3}\s*final\s+brief(ing)?\s*:?\s*$/im,
  /^#{0,3}\s*summary\s+for\s+the\s+owner\s*:?\s*$/im,
];

function extractOwnerBrief(content: string | undefined): string | null {
  if (!content) return null;
  for (const marker of OWNER_MARKERS) {
    const m = marker.exec(content);
    if (!m) continue;
    const rest = content.slice(m.index + m[0].length);
    // stop at the next heading — the owner section only
    const section = rest.split(/\n#{1,6}\s/)[0].trim();
    if (section.length < 24) continue;
    // hard reject anything carrying internal machinery
    if (/tool[_ ]?call|tool:|observation|thought|reasoning|chain[- ]of[- ]thought|function_call|<\/?think/i.test(section))
      continue;
    return section;
  }
  return null;
}

type AuditRow = {
  id: string;
  intent: string | null;
  department: string | null;
  urgency: string | null;
  created_at: string;
};

export default function Dashboard() {
  const { data } = useCms();
  const { data: ops, loading: opsLoading } = useOperations();
  const portal = usePortalOps();
  const brief = computeBriefing(ops, data.homepage.rooms);
  const { status: tallaStatus, loading: tallaLoading } = useTallaStatus();

  const requests = useGuestRequests();
  const housekeeping = useHousekeepingTasks();
  const maintenance = useMaintenanceRequests();
  const foodOrders = useFoodOrders();

  // ---- Owner-facing cloud brief (optional, strictly filtered)
  const [cloudBrief, setCloudBrief] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { artifacts } = await fetchLatestBriefing(TALLA_TENANT);
        const latest = artifacts[0];
        const owner = extractOwnerBrief(latest?.content ?? latest?.contentPreview);
        if (alive && owner) setCloudBrief(owner);
      } catch {
        // unreachable or unsafe -> computed brief stands
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---- Today / tomorrow from the same bookings snapshot
  const today = iso(new Date());
  const tomorrow = iso(new Date(Date.now() + 86400000));
  const active = useMemo(() => ops.bookings.filter((b) => b.status !== "cancelled"), [ops.bookings]);
  const arrivalsTomorrow = active.filter((b) => b.checkIn === tomorrow).length;
  const departuresTomorrow = active.filter((b) => b.checkOut === tomorrow).length;

  // ---- TALA activity (existing tala_audit_log)
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [auditFailed, setAuditFailed] = useState(false);
  const loadAudit = useCallback(async () => {
    try {
      if (!isSupabaseConnected() || !supabase) {
        setAudit([]);
        return;
      }
      const { data: rows, error } = await supabase
        .from("tala_audit_log")
        .select("id, intent, department, urgency, created_at")
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      setAudit((rows as AuditRow[]) ?? []);
    } catch {
      setAuditFailed(true);
      setAudit([]);
    }
  }, []);
  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  // ---- Needs attention: real exceptions only
  const openRequests = (requests.data ?? []).filter(
    (r) => r.status !== "completed" && r.status !== "cancelled" && r.status !== "closed",
  );
  const openHousekeeping = (housekeeping.data ?? []).filter(
    (t) => t.status !== "completed" && t.status !== "cancelled",
  );
  const openMaintenance = (maintenance.data ?? []).filter(
    (m) => m.status !== "completed" && m.status !== "cancelled",
  );
  const openOrders = (foodOrders.data ?? []).filter(
    (o) => o.status !== "delivered" && o.status !== "cancelled",
  );

  // ---- Guest Portal operational tables (same rows the Portal creates and
  // TALA reads). Resolves to [] until David runs the schema migration.
  const pendingPortalTours = portal.tours.filter((t) => t.status === "requested").length;
  const pendingPortalRentals = portal.rentals.filter((r) => r.status === "requested").length;
  const pendingPortalBookings = portal.bookings.filter((b) => b.status === "requested").length;
  const unreadPortalMessages = portal.messages.filter((m) => m.status === "unread").length;

  // Booking-derived attention (real resort state, not hard-coded names).
  const activeBookings = active;
  const tomorrowArrivals = activeBookings.filter((b) => b.checkIn === tomorrow);
  const tomorrowDepartures = activeBookings.filter((b) => b.checkOut === tomorrow);
  const outstandingBalances = activeBookings.filter(
    (b) => (b.paidAmount ?? 0) < (b.amount ?? 0) && (b.amount ?? 0) > 0,
  );
  const bookingNotes = activeBookings.filter(
    (b) => (b.notes ?? "").trim().length > 0,
  );

  const attention: { label: string; to: string; count?: string }[] = [];
  if (brief.pendingBookings)
    attention.push({ label: "Bookings awaiting your confirmation", to: "/admin/bookings", count: String(brief.pendingBookings) });
  if (tomorrowArrivals.length)
    attention.push({
      label: `Arrivals tomorrow (${tomorrowArrivals.length}) need preparation`,
      to: "/admin/bookings",
      count: String(tomorrowArrivals.length),
    });
  if (tomorrowDepartures.length)
    attention.push({
      label: `Departures tomorrow (${tomorrowDepartures.length}) — checkout & keys`,
      to: "/admin/bookings",
      count: String(tomorrowDepartures.length),
    });
  if (outstandingBalances.length) {
    const total = outstandingBalances.reduce(
      (s, b) => s + ((b.amount ?? 0) - (b.paidAmount ?? 0)),
      0,
    );
    attention.push({
      label: `Outstanding balances (${outstandingBalances.length})`,
      to: "/admin/bookings",
      count: formatPHP(total),
    });
  }
  if (bookingNotes.length)
    attention.push({
      label: `Special requests / notes (${bookingNotes.length})`,
      to: "/admin/bookings",
      count: String(bookingNotes.length),
    });
  if (openRequests.length)
    attention.push({ label: "Open guest requests", to: "/admin/messages", count: String(openRequests.length) });
  if (openMaintenance.length)
    attention.push({ label: "Maintenance still open", to: "/admin/tala/ops", count: String(openMaintenance.length) });
  if (openHousekeeping.length)
    attention.push({ label: "Housekeeping tasks pending", to: "/admin/tala/ops", count: String(openHousekeeping.length) });
  if (openOrders.length)
    attention.push({ label: "Food orders in progress", to: "/admin/food-orders", count: String(openOrders.length) });
  if (pendingPortalTours)
    attention.push({ label: "New tour requests", to: "/admin/tours", count: String(pendingPortalTours) });
  if (pendingPortalRentals)
    attention.push({ label: "New motorbike requests", to: "/admin/rentals", count: String(pendingPortalRentals) });
  if (pendingPortalBookings)
    attention.push({ label: "New stay requests", to: "/admin/bookings", count: String(pendingPortalBookings) });
  if (unreadPortalMessages)
    attention.push({ label: "Unread guest messages", to: "/admin/messages", count: String(unreadPortalMessages) });
  if (brief.lowStockItems.length)
    attention.push({ label: `Low stock: ${brief.lowStockItems.slice(0, 3).join(", ")}`, to: "/admin/inventory", count: String(brief.lowStockItems.length) });
  if (brief.unpaidPayroll > 0)
    attention.push({ label: "Unpaid payroll", to: "/admin/staff", count: formatPHP(brief.unpaidPayroll) });
  if (brief.bikesMaintenance)
    attention.push({ label: "Bikes in maintenance", to: "/admin/rentals", count: String(brief.bikesMaintenance) });
  if (brief.roomsOpenToday.length)
    attention.push({ label: `Open tonight: ${brief.roomsOpenToday.slice(0, 3).join(", ")}`, to: "/admin/bookings", count: String(brief.roomsOpenToday.length) });

  return (
    <div>
      <PageHeader
        title="Command Center"
        description={`Marina Terrace — live overview for ${today}.`}
        actions={
          <>
            <Link
              to="/admin/tala/ops"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#C6A15B] px-4 py-2 text-xs font-medium uppercase tracking-wide text-[#221D14] hover:bg-[#B8924B]"
            >
              <Bot className="h-3.5 w-3.5" /> TALA Operations
            </Link>
            <Link
              to="/"
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#26221C] px-4 py-2 text-xs font-medium uppercase tracking-wide text-white hover:bg-[#3a3327]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Live Site
            </Link>
          </>
        }
      />

      {/* 1 — TALA Briefing */}
      <section className="mb-5 overflow-hidden rounded-2xl bg-[#1B1812] p-5 text-white shadow-sm sm:p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#C6A15B]">
              <Sunrise className="h-4 w-4 text-[#221D14]" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-serif text-base leading-tight sm:text-lg">Morning Brief</p>
              <p className="text-[11px] text-white/40">{brief.briefDate}</p>
            </div>
          </div>
          <Link
            to="/admin/tala/ops"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-white/15"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Ask TALA
          </Link>
        </div>

        {opsLoading && !cloudBrief ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the property…
          </p>
        ) : (
          <p className="mt-4 whitespace-pre-line text-[13px] leading-relaxed text-white/80 sm:text-sm">
            {cloudBrief ?? brief.summary}
          </p>
        )}

        {brief.highlights.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {brief.highlights.slice(0, 6).map((h, i) => (
              <span key={i} className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-white/70">
                {h}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 3 — Today / Tomorrow */}
      <section className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Guests In-House" value={brief.inHouse} to="/admin/bookings" icon={Users} />
        <MetricCard label="Arrivals Today" value={brief.arrivalsToday} to="/admin/bookings" icon={CalendarCheck} />
        <MetricCard label="Departures Today" value={brief.departuresToday} to="/admin/bookings" icon={CalendarCheck} />
        <MetricCard label="Arrivals Tomorrow" value={arrivalsTomorrow} to="/admin/bookings" icon={CalendarCheck} />
        <MetricCard label="Departures Tomorrow" value={departuresTomorrow} to="/admin/bookings" icon={CalendarCheck} />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* 2 — Needs Attention */}
        <section className="rounded-2xl border border-[#26221C]/8 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4" style={{ color: GOLD }} strokeWidth={1.75} />
            <h2 className="font-serif text-base text-[#26221C] sm:text-lg">Needs Attention</h2>
            {attention.length > 0 && (
              <span className="rounded-full bg-[#26221C]/8 px-1.5 text-[10px] font-semibold text-[#26221C]/60">
                {attention.length}
              </span>
            )}
          </div>
          {attention.length === 0 ? (
            <p className="py-6 text-center text-sm text-[#26221C]/45">
              {opsLoading ? "Checking…" : "Nothing needs your attention right now."}
            </p>
          ) : (
            <ul className="divide-y divide-[#26221C]/6">
              {attention.map((a) => (
                <li key={a.label}>
                  <Link
                    to={a.to}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5"
                  >
                    <span className="min-w-0 truncate text-[13px] text-[#26221C]/75 group-hover:text-[#26221C]">
                      {a.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {a.count && (
                        <span className="font-serif text-sm text-[#26221C]">{a.count}</span>
                      )}
                      <ArrowUpRight className="h-3.5 w-3.5 text-[#26221C]/25 group-hover:text-[#C6A15B]" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 4 — Operations */}
        <section className="rounded-2xl border border-[#26221C]/8 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-serif text-base text-[#26221C] sm:text-lg">Operations</h2>
          <div className="grid grid-cols-1 divide-y divide-[#26221C]/6">
            <OpsRow
              label="Guest Requests"
              icon={MessageCircle}
              to="/admin/messages"
              query={requests}
              value={openRequests.length}
              unit="open"
            />
            <OpsRow
              label="Housekeeping"
              icon={Sparkle}
              to="/admin/tala/ops"
              query={housekeeping}
              value={openHousekeeping.length}
              unit="pending"
            />
            <OpsRow
              label="Maintenance"
              icon={Wrench}
              to="/admin/tala/ops"
              query={maintenance}
              value={openMaintenance.length}
              unit="open"
            />
            <OpsRow
              label="Food Orders"
              icon={ChefHat}
              to="/admin/food-orders"
              query={foodOrders}
              value={openOrders.length}
              unit="in progress"
            />
            <OpsRow
              label="Inventory"
              icon={Package}
              to="/admin/inventory"
              query={{ isLoading: opsLoading, isError: false }}
              value={brief.lowStockItems.length}
              unit={`low of ${ops.inventory.length}`}
            />
          </div>
        </section>
      </div>

      {/* 5 — TALA Activity */}
      <section className="mt-5 rounded-2xl border border-[#26221C]/8 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-serif text-base text-[#26221C] sm:text-lg">TALA Activity</h2>
          <Link to="/admin/tala" className="shrink-0 text-[11px] font-medium text-[#C6A15B] hover:underline">
            View all →
          </Link>
        </div>
        {audit === null ? (
          <p className="py-5 text-center text-sm text-[#26221C]/45">Loading…</p>
        ) : audit.length === 0 ? (
          <p className="py-5 text-center text-sm text-[#26221C]/45">
            {auditFailed
              ? "Activity history isn't available right now."
              : "No recorded TALA activity yet."}
          </p>
        ) : (
          <ul className="divide-y divide-[#26221C]/6">
            {audit.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                <span className="min-w-0 truncate text-[13px] text-[#26221C]/75">
                  {r.intent || "Guest conversation"}
                  {r.department ? <span className="text-[#26221C]/40"> · {r.department}</span> : null}
                </span>
                <span className="shrink-0 text-[11px] text-[#26221C]/40">
                  {new Date(r.created_at).toLocaleString("en-PH", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6 — System Health */}
      <section className="mt-5 rounded-2xl border border-[#26221C]/8 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#26221C]/40">
            System Health
          </p>
          <div className="flex flex-wrap gap-1.5">
            <HealthPill label="TALA" state={tallaLoading ? "loading" : (tallaStatus?.tala ?? "unknown")} />
            <HealthPill
              label="Supabase"
              state={opsLoading ? "loading" : ops.bookings.length || ops.inventory.length || ops.staff.length ? "connected" : "unknown"}
            />
            <HealthPill label="Automation" state={tallaLoading ? "loading" : (tallaStatus?.automation ?? "unknown")} />
            <HealthPill label="Computer" state={tallaLoading ? "loading" : (tallaStatus?.computer ?? "unknown")} />
            <HealthPill label="OpenRouter" state={tallaLoading ? "loading" : (tallaStatus?.model ?? "unknown")} />
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  to,
  icon: Icon,
}: {
  label: string;
  value: number;
  to: string;
  icon: typeof Users;
}) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-[#26221C]/8 bg-white p-4 shadow-sm transition hover:border-[#C6A15B]/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4" style={{ color: GOLD }} strokeWidth={1.5} />
        <ArrowUpRight className="h-3.5 w-3.5 text-[#26221C]/15 group-hover:text-[#C6A15B]" />
      </div>
      <p className="mt-2.5 font-serif text-2xl" style={{ color: INK }}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-[#26221C]/45">{label}</p>
    </Link>
  );
}

function OpsRow({
  label,
  icon: Icon,
  to,
  query,
  value,
  unit,
}: {
  label: string;
  icon: typeof Users;
  to: string;
  query: { isLoading: boolean; isError: boolean };
  value: number;
  unit: string;
}) {
  return (
    <Link to={to} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#26221C]/35" strokeWidth={1.75} />
        <span className="truncate text-[13px] text-[#26221C]/75 group-hover:text-[#26221C]">
          {label}
        </span>
      </span>
      <span className="shrink-0 text-[11px]">
        {query.isLoading ? (
          <span className="text-[#26221C]/35">Checking…</span>
        ) : query.isError ? (
          <span className="text-[#26221C]/35">Unavailable</span>
        ) : (
          <>
            <span className="font-serif text-sm text-[#26221C]">{value}</span>
            <span className="ml-1 text-[#26221C]/40">{unit}</span>
          </>
        )}
      </span>
    </Link>
  );
}

type PillState =
  | "online"
  | "offline"
  | "ready"
  | "running"
  | "connected"
  | "off"
  | "unknown"
  | "loading";

const PILL_META: Record<PillState, { text: string; tone: string; Icon: typeof CircleCheck }> = {
  online: { text: "Online", tone: "bg-green-50 text-green-700", Icon: CircleCheck },
  offline: { text: "Offline", tone: "bg-red-50 text-red-700", Icon: CircleSlash },
  ready: { text: "Ready", tone: "bg-green-50 text-green-700", Icon: CircleCheck },
  running: { text: "Running", tone: "bg-green-50 text-green-700", Icon: CircleCheck },
  connected: { text: "Connected", tone: "bg-green-50 text-green-700", Icon: CircleCheck },
  off: { text: "Off", tone: "bg-slate-100 text-slate-500", Icon: CircleSlash },
  unknown: { text: "Unknown", tone: "bg-amber-50 text-amber-700", Icon: CircleHelp },
  loading: { text: "Checking…", tone: "bg-slate-100 text-slate-500", Icon: Loader2 },
};

function HealthPill({ label, state }: { label: string; state: PillState }) {
  const meta = PILL_META[state];
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${meta.tone}`}>
      <Icon className={`h-3 w-3 ${state === "loading" ? "animate-spin" : ""}`} />
      <span className="text-[#26221C]/50">{label}</span>
      {meta.text}
    </span>
  );
}
