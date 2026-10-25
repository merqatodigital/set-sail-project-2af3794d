import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bike,
  BedDouble,
  Bot,
  Brain,
  CheckCircle2,
  Circle,
  CloudSun,
  ClipboardList,
  Lightbulb,
  Loader2,
  MessageCircle,
  Package,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  UserPlus,
} from "lucide-react";
import { useCms } from "@/context/CmsContext";
import { useToast } from "@/context/ToastContext";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { PageHeader, TabBar } from "../shared/PageHeader";
import { useTalaChat } from "@/components/tala/useTalaChat";
import { buildTalaSystemPrompt } from "@/components/tala/talaPersona";
import { useTalaLiveContext, withLiveContext } from "@/components/tala/useTalaLiveContext";
import { computeBriefing } from "@/components/tala/buildTalaBriefing";
import { useOperations } from "../ops/useOperations";
import type { OperationsSnapshot } from "@/lib/opsRepo";
import { fetchSanVicenteWeather, type WeatherNow } from "@/lib/weather";
import { sendWhatsAppTemplate } from "@/lib/whatsappSend";
import {
  addTalaBriefing,
  addTalaGoal,
  addTalaTask,
  addTalaWin,
  buildBriefingWhatsAppLink,
  buildLeadWhatsAppLink,
  fetchTalaBriefings,
  fetchTalaGoals,
  fetchTalaTasks,
  fetchTalaWins,
  fetchTalaLeads,
  generateTalaBriefing,
  markBriefingWhatsappSent,
  type TalaBriefing,
  type TalaGoal,
  type TalaLead,
  type TalaTask,
  type TalaWin,
} from "@/components/tala/talaOps";
import { askTalla, fetchLatestBriefing, triggerBriefing } from "@/lib/tallaCloud";

type Tab = "chat" | "briefing" | "goals" | "tasks" | "wins" | "leads";

export default function TalaOps() {
  const { data } = useCms();
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("chat");
  const { data: ops, refresh: refreshOps } = useOperations();

  return (
    <div>
      <PageHeader
        title="TALA — Operations Console"
        description="Talk to TALA as the operator, read her morning briefings, and track her goals, weekly tasks and wins. The guest orb on the site is separate — this is the team's back-office window into TALA."
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "chat", label: "Chat" },
          { id: "briefing", label: "Morning Brief" },
          { id: "goals", label: "Goals" },
          { id: "tasks", label: "Tasks" },
          { id: "wins", label: "Wins" },
          { id: "leads", label: "Leads" },
        ]}
      />
      {tab === "chat" && <ChatTab cms={data} ops={ops} refreshOps={refreshOps} notify={notify} />}
      {tab === "briefing" && <BriefingTab cms={data} ops={ops} notify={notify} />}
      {tab === "goals" && <GoalsTab notify={notify} />}
      {tab === "tasks" && <TasksTab notify={notify} />}
      {tab === "wins" && <WinsTab cms={data} notify={notify} />}
      {tab === "leads" && <LeadsTab cms={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CHAT — operator face. Same brain as the guest orb (useTalaChat -> tala-chat
// edge function or admin/api key). Different system prompt: she is reporting to
// the owner/team, can reference ops, and is allowed to be more direct.
// ---------------------------------------------------------------------------
function operatorPrompt(siteName: string): string {
  return [
    `You are TALA, the AI operations concierge for ${siteName} in San Vicente, Palawan.`,
    `You are speaking with the OWNER or STAFF (not a guest). Be direct, concise and useful.`,
    `You can reference bookings, tours, staff, payments and tasks. When asked for a morning update, give a tight rundown of today's arrivals, departures, tours, bikes out, in-house guests, and any unpaid payroll or money notes.`,
    `You can ACT on the owner's behalf using tools: create_booking, update_booking (confirm/cancel/check-in/out), create_tour_booking, update_rental (mark a motorbike rented/returned/maintenance), run_payroll (compute staff pay for a date range), mark_pay_record_paid, log_payment (record revenue or expense), check_inventory (stock levels — linens, towels, bathroom, food, gas, fuel), adjust_inventory (log stock used or restocked), and send_whatsapp_message (send a real WhatsApp text right now — only works if that person messaged this number in the last 24h, otherwise tell the owner to use a template from Admin -> Bookings/WhatsApp instead). Only use these when the owner clearly asks you to make a change, and report the resulting reference/status back.`,
    `Never invent numbers — use what is in context. If you don't know, say so. Keep replies to 1-4 sentences unless detail is asked for.`,
  ].join("\n");
}

/**
 * Compact live-operations context appended to owner chat messages.
 *
 * The operator prompt promises "use what is in context", but no numbers
 * were ever attached — so owner questions like "how did we do this month?"
 * had nothing to answer from unless the Cloudflare Worker (with its
 * finance tools) is deployed. This computes the same headline figures the
 * admin Financial page shows, from the ops snapshot this page already
 * loads, so the same-origin chat backend can answer truthfully too.
 * Trailing 30 days, matching the Worker's finance "month" period.
 */
function buildOpsContext(
  ops: OperationsSnapshot,
  financial: { dailyLaborCost: number; monthlyUtilities: number },
): string {
  const peso = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const active = (s: string) => s !== "cancelled";
  const inWindow = (d: string) => (d ?? "").slice(0, 10) >= start;

  const bookings = ops.bookings.filter((b) => active(b.status) && inWindow(b.createdAt));
  const tours = ops.tourBookings.filter((t) => active(t.status) && inWindow(t.createdAt));
  const rentals = ops.motorbikeRentals.filter((r) => active(r.status) && inWindow(r.createdAt));
  const revRooms = bookings.reduce((s, b) => s + (b.amount ?? 0), 0);
  const revTours = tours.reduce((s, t) => s + (t.amount ?? 0), 0);
  const revRentals = rentals.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalRevenue = revRooms + revTours + revRentals;
  const collected =
    bookings.reduce((s, b) => s + (b.paidAmount ?? 0), 0) +
    tours.reduce((s, t) => s + (t.paidAmount ?? 0), 0) +
    rentals.reduce((s, r) => s + (r.paidAmount ?? 0), 0);

  const fixedCosts = financial.dailyLaborCost * 30 + financial.monthlyUtilities;
  const ledgerOut = ops.payments.filter((p) => p.direction === "out" && inWindow(p.date));
  const expenses = ledgerOut.reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalCosts = fixedCosts + expenses;

  const owed = [
    ...ops.bookings.map((b) => ({ kind: "room", guest: b.guestName, ref: b.reference, bal: (b.amount ?? 0) - (b.paidAmount ?? 0), status: b.status })),
    ...ops.tourBookings.map((t) => ({ kind: "tour", guest: t.guestName, ref: t.reference, bal: (t.amount ?? 0) - (t.paidAmount ?? 0), status: t.status })),
    ...ops.motorbikeRentals.map((r) => ({ kind: "rental", guest: r.guestName, ref: r.reference, bal: (r.amount ?? 0) - (r.paidAmount ?? 0), status: r.status })),
  ]
    .filter((o) => active(o.status) && o.bal > 0)
    .sort((a, b) => b.bal - a.bal);
  const totalOwed = owed.reduce((s, o) => s + o.bal, 0);

  const arrivalsToday = ops.bookings.filter((b) => active(b.status) && b.checkIn === today).length;
  const departuresToday = ops.bookings.filter((b) => active(b.status) && b.checkOut === today).length;
  const inHouse = ops.bookings.filter(
    (b) => active(b.status) && b.checkIn <= today && b.checkOut > today,
  ).length;

  return [
    `As of ${today} (trailing 30 days since ${start}):`,
    `Revenue booked: rooms ${peso(revRooms)}, tours ${peso(revTours)}, rentals ${peso(revRentals)} — total ${peso(totalRevenue)}. Collected so far (paid): ${peso(collected)}. Food revenue is not included in this snapshot.`,
    `Costs: fixed labor+utilities estimate ${peso(fixedCosts)}, payments-ledger expenses ${peso(expenses)} — total ${peso(totalCosts)}. Estimated net: ${peso(totalRevenue - totalCosts)}.`,
    `Outstanding balances: ${owed.length} guest(s) owe ${peso(totalOwed)} total.` +
      (owed.length
        ? ` Largest: ${owed.slice(0, 8).map((o) => `${o.guest} (${o.kind} ${o.ref}, owes ${peso(o.bal)})`).join("; ")}.`
        : ""),
    `Today: ${arrivalsToday} arrival(s), ${departuresToday} departure(s), ${inHouse} booking(s) in-house.`,
    `Recent ledger entries: ${ops.payments.slice(0, 8).map((p) => `${p.date} ${p.direction} ${peso(p.amount)} ${p.category}${p.description ? ` (${p.description})` : ""}`).join("; ") || "none recorded"}.`,
  ].join("\n");
}

function ChatTab({
  cms,
  ops,
  refreshOps,
  notify,
}: {
  cms: import("@/types/cms").CmsData;
  ops: OperationsSnapshot;
  refreshOps: () => Promise<void>;
  notify: ReturnType<typeof useToast>["notify"];
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<
    { id: string; role: "user" | "assistant"; content: string }[]
  >([]);
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const siteName = cms.settings.siteName || "Marina Terrace";

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setErr(null);
    setThinking(true);
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const result = await askTalla(
        `${operatorPrompt(siteName)}\n\nLIVE OPERATIONS DATA (from the admin database — answer money questions from these figures, never invent others):\n${buildOpsContext(ops, cms.settings.financial)}\n\nOwner question: ${text}`,
        { role: "owner" },
        ac.signal,
      );
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: result.content ?? "(no reply)" },
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "TALA didn't respond.");
    } finally {
      setThinking(false);
    }
  }, [draft, siteName, ops, cms.settings.financial]);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Bot className="h-4 w-4 text-[#C6A15B]" />
        <p className="font-serif text-lg text-[#26221C]">Talk to TALA</p>
      </div>
      <div className="mb-4 max-h-96 space-y-3 overflow-y-auto rounded-lg bg-[#FAF6EF] p-4">
        {messages.length === 0 && (
          <p className="text-sm text-[#26221C]/45">
            Ask TALA for today's rundown, "what needs my attention?", or "summarise this week's
            bookings". She uses the same brain as the guest orb.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                m.role === "user" ? "bg-[#26221C] text-white" : "bg-white text-[#26221C] shadow-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2 text-sm text-[#26221C]/60 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#C6A15B]" />
              TALA is thinking…
            </div>
          </div>
        )}
      </div>
      {err && <p className="mb-3 text-xs text-red-500">{err}</p>}
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message TALA as the operator…"
          className="min-h-[52px]"
        />
        <Button onClick={send} disabled={thinking || !draft.trim()}>
          <Send className="h-4 w-4" /> Send
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-[#26221C]/40">
        TALA runs on the Cloudflare agentic backend (same TallaAgent as the guest orb). If chat is
        blank or errors, the backend may be unreachable — check the status on the Dashboard.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MORNING BRIEF — computed live from ops data, stored as a briefing row.
// ---------------------------------------------------------------------------
function BriefingTab({
  cms,
  ops,
  notify,
}: {
  cms: import("@/types/cms").CmsData;
  ops: OperationsSnapshot;
  notify: ReturnType<typeof useToast>["notify"];
}) {
  const [briefings, setBriefings] = useState<TalaBriefing[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [yesterdayWins, setYesterdayWins] = useState<TalaWin[]>([]);
  // Real briefing from the proven DailyResortBriefingWorkflow (Cloudflare/D1).
  const [cloudBriefing, setCloudBriefing] = useState<{
    date: string;
    summary: string;
    createdAt: string;
  } | null>(null);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const live = computeBriefing(ops, cms.homepage.rooms);

  const loadCloudBriefing = useCallback(async () => {
    setCloudLoading(true);
    setCloudError(null);
    try {
      const { artifacts } = await fetchLatestBriefing();
      const latest = artifacts[0];
      if (latest) {
        setCloudBriefing({
          date: latest.date,
          summary: latest.content ?? latest.contentPreview,
          createdAt: latest.createdAt,
        });
      } else {
        setCloudBriefing(null);
      }
    } catch (e) {
      setCloudError(e instanceof Error ? e.message : "Couldn't load the latest briefing.");
    } finally {
      setCloudLoading(false);
    }
  }, []);

  const load = useCallback(() => {
    fetchTalaBriefings().then(setBriefings);
  }, []);
  useEffect(() => {
    load();
    void loadCloudBriefing();
  }, [load, loadCloudBriefing]);

  useEffect(() => {
    setWeatherLoading(true);
    fetchSanVicenteWeather().then((w) => {
      setWeather(w);
      setWeatherLoading(false);
    });
  }, []);

  useEffect(() => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    fetchTalaWins().then((wins) =>
      setYesterdayWins(wins.filter((w) => w.brief_date === yesterday)),
    );
  }, []);

  // Refresh briefing = trigger the EXISTING DailyResortBriefingWorkflow on the
  // proven Cloudflare backend (then surface its D1 artifact). Supabase
  // generate path remains as a fallback if the backend is unreachable.
  const refreshFromCloud = useCallback(async () => {
    setGenerating(true);
    try {
      await triggerBriefing();
      await loadCloudBriefing();
      notify("Morning briefing refreshed from TALA's automation.", "success");
    } catch (e) {
      notify(
        `Cloud briefing unavailable (${e instanceof Error ? e.message : "error"}) — using the Supabase generator instead.`,
        "error",
      );
      const saved = await generateTalaBriefing();
      if (!saved) {
        const snap = computeBriefing(ops, cms.homepage.rooms);
        await addTalaBriefing({
          brief_date: snap.briefDate,
          summary: snap.summary,
          highlights: snap.highlights,
        });
      }
      load();
    } finally {
      setGenerating(false);
    }
  }, [ops, cms.homepage.rooms, notify, load, loadCloudBriefing]);

  const sendToWhatsApp = useCallback(
    async (b: TalaBriefing) => {
      if (!cms.settings.whatsapp.numbers.length) {
        notify("No WhatsApp number set. Add one in Admin → WhatsApp.", "error");
        return;
      }
      const cloudApi = cms.settings.whatsapp.cloudApi;
      const templateName = cloudApi?.enabled ? cloudApi.templates.dailyBrief.trim() : "";
      if (templateName) {
        const primary =
          cms.settings.whatsapp.numbers.find((n) => n.isPrimary) ??
          cms.settings.whatsapp.numbers[0];
        const to = primary.number;
        const result = await sendWhatsAppTemplate(to, templateName, cloudApi.templateLanguage, [
          b.summary,
        ]);
        if (result.success) {
          await markBriefingWhatsappSent(b.id);
          notify("Briefing sent over WhatsApp.", "success");
          load();
          return;
        }
        notify(`Cloud API send failed (${result.error}). Opening wa.me link instead.`, "error");
      }
      const link = buildBriefingWhatsAppLink(b, cms.settings.whatsapp);
      window.open(link, "_blank");
      await markBriefingWhatsappSent(b.id);
      notify("Opened WhatsApp with the briefing pre-filled.", "success");
      load();
    },
    [cms.settings.whatsapp, notify, load],
  );

  return (
    <div>
      {/* Live snapshot — always current, refreshes with ops data + weather,
          independent of whether today's stored briefing has been generated
          yet. This is what makes the console feel "alive" between the
          scheduled 7am briefings, not just a static report you generate once. */}
      <Card className="mb-6 p-6">
        <p className="mb-3 flex items-center gap-2 font-serif text-lg text-[#26221C]">
          <CloudSun className="h-4 w-4 text-[#C6A15B]" /> Right now in San Vicente
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg bg-[#FAF6EF] p-3">
            <p className="text-[11px] uppercase tracking-wide text-[#26221C]/45">Weather</p>
            {weatherLoading ? (
              <p className="mt-1 text-sm text-[#26221C]/45">Loading…</p>
            ) : weather ? (
              <p className="mt-1 text-sm font-medium text-[#26221C]">
                {Math.round(weather.tempC)}°C · {weather.description}
                <span className="block text-xs font-normal text-[#26221C]/45">
                  Wind {Math.round(weather.windKph)} km/h
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-[#26221C]/45">Unavailable right now.</p>
            )}
          </div>
          <div className="rounded-lg bg-[#FAF6EF] p-3">
            <p className="text-[11px] uppercase tracking-wide text-[#26221C]/45 flex items-center gap-1">
              <BedDouble className="h-3 w-3" /> Open tonight
            </p>
            <p className="mt-1 text-sm font-medium text-[#26221C]">
              {live.roomsOpenToday.length > 0 ? live.roomsOpenToday.join(", ") : "Fully booked"}
            </p>
          </div>
          <div className="rounded-lg bg-[#FAF6EF] p-3">
            <p className="text-[11px] uppercase tracking-wide text-[#26221C]/45 flex items-center gap-1">
              <Bike className="h-3 w-3" /> Bikes ready
            </p>
            <p className="mt-1 text-sm font-medium text-[#26221C]">
              {live.bikesAvailable} ready · {live.bikesOut} out
              {live.bikesMaintenance ? ` · ${live.bikesMaintenance} in maintenance` : ""}
            </p>
          </div>
          <div className="rounded-lg bg-[#FAF6EF] p-3">
            <p className="text-[11px] uppercase tracking-wide text-[#26221C]/45">Needs you</p>
            <p className="mt-1 text-sm font-medium text-[#26221C]">
              {live.pendingBookings > 0
                ? `${live.pendingBookings} booking${live.pendingBookings > 1 ? "s" : ""} to confirm`
                : "Nothing pending"}
            </p>
          </div>
          <div className="rounded-lg bg-[#FAF6EF] p-3">
            <p className="text-[11px] uppercase tracking-wide text-[#26221C]/45 flex items-center gap-1">
              <Package className="h-3 w-3" /> Stock
            </p>
            <p className="mt-1 text-sm font-medium text-[#26221C]">
              {live.lowStockItems.length > 0
                ? `Low: ${live.lowStockItems.join(", ")}`
                : "All stocked up"}
            </p>
          </div>
        </div>
        {yesterdayWins.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[#26221C]/45">
              Yesterday's wins
            </p>
            <ul className="space-y-1 text-sm text-[#26221C]/70">
              {yesterdayWins.map((w) => (
                <li key={w.id}>• {w.text}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="mb-6 p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#C6A15B]" />
            <p className="font-serif text-lg text-[#26221C]">This morning's brief</p>
          </div>
          <Button onClick={refreshFromCloud} disabled={generating}>
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh from TALA
          </Button>
          {briefings && briefings.length > 0 && (
            <Button variant="outline" onClick={() => sendToWhatsApp(briefings[0])}>
              <MessageCircle className="h-4 w-4" />
              Send to WhatsApp
            </Button>
          )}
        </div>
        {/* Real briefing produced by TALA's automation (DailyResortBriefingWorkflow
            on the proven Cloudflare backend). This is the source of truth. */}
        {cloudLoading ? (
          <p className="text-sm text-[#26221C]/45">Loading TALA's latest briefing…</p>
        ) : cloudError ? (
          <p className="text-sm text-[#26221C]/45">
            TALA's automation briefing is unavailable right now ({cloudError}).
          </p>
        ) : cloudBriefing ? (
          <div className="mt-4 rounded-lg border border-[#C6A15B]/30 bg-[#FBF7EE] p-4">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[#26221C]/45">
              <Sparkles className="h-3.5 w-3.5 text-[#C6A15B]" />
              TALA automation · {cloudBriefing.date}
              <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                Generated {new Date(cloudBriefing.createdAt).toLocaleString()}
              </span>
            </p>
            <p className="text-sm leading-relaxed text-[#26221C]">{cloudBriefing.summary}</p>
          </div>
        ) : (
          <p className="text-sm text-[#26221C]/45">
            No automation briefing yet. Click "Refresh from TALA" to generate today's rundown.
          </p>
        )}
        {briefings && briefings.length > 0 ? (
          <div className="rounded-lg bg-[#FAF6EF] p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#26221C]/45">
              {briefings[0].brief_date}
              {briefings[0].whatsapp_sent && (
                <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  Sent to WhatsApp
                </span>
              )}
            </p>
            <p className="text-sm leading-relaxed text-[#26221C]">{briefings[0].summary}</p>
            {briefings[0].highlights.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {briefings[0].highlights.map((h, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-white px-2.5 py-1 text-xs text-[#26221C]/70 shadow-sm"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[#26221C]/45">
            No briefing yet. Click "Generate briefing" to compute today's rundown from live
            bookings, tours, staff and payments.
          </p>
        )}
      </Card>

      <Card className="p-6">
        <p className="mb-3 flex items-center gap-2 font-serif text-lg text-[#26221C]">
          <Brain className="h-4 w-4 text-[#C6A15B]" /> Briefing history
        </p>
        {briefings && briefings.length > 1 ? (
          <div className="space-y-3">
            {briefings.slice(1).map((b) => (
              <div key={b.id} className="rounded-lg border border-[#26221C]/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="mb-1 text-xs font-medium text-[#26221C]/45">{b.brief_date}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[#C6A15B]"
                    onClick={() => sendToWhatsApp(b)}
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Send
                  </Button>
                </div>
                <p className="text-sm text-[#26221C]">{b.summary}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#26221C]/45">Past briefings will appear here.</p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GOALS — what TALA is working toward.
// ---------------------------------------------------------------------------
function GoalsTab({ notify }: { notify: ReturnType<typeof useToast>["notify"] }) {
  const [goals, setGoals] = useState<TalaGoal[] | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const load = useCallback(() => fetchTalaGoals().then(setGoals), []);
  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async () => {
    if (!title.trim()) return;
    const row = await addTalaGoal({ title, description: desc });
    if (row) {
      setTitle("");
      setDesc("");
      notify("Goal added.", "success");
      load();
    } else notify("Could not save goal.", "error");
  }, [title, desc, notify, load]);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Target className="h-4 w-4 text-[#C6A15B]" />
        <p className="font-serif text-lg text-[#26221C]">Goals</p>
      </div>
      <div className="mb-5 grid gap-2 md:grid-cols-[1fr_2fr_auto]">
        <Field label="Goal title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fill 3 day-passes this week"
          />
        </Field>
        <Field label="Notes (optional)">
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What success looks like"
          />
        </Field>
        <div className="flex items-end">
          <Button onClick={add} disabled={!title.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>
      {goals === null ? (
        <p className="text-sm text-[#26221C]/45">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-[#26221C]/45">No goals yet. Add TALA's first objective.</p>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => (
            <div
              key={g.id}
              className="flex items-start gap-3 rounded-lg border border-[#26221C]/10 p-3"
            >
              {g.status === "done" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 text-[#C6A15B]" />
              )}
              <div>
                <p
                  className={`text-sm font-medium ${g.status === "done" ? "text-[#26221C]/45 line-through" : "text-[#26221C]"}`}
                >
                  {g.title}
                </p>
                {g.description && <p className="text-xs text-[#26221C]/50">{g.description}</p>}
                {g.target_date && (
                  <p className="text-[11px] text-[#26221C]/40">Target: {g.target_date}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// TASKS — weekly / one-off tasks TALA tracks.
// ---------------------------------------------------------------------------
function TasksTab({ notify }: { notify: ReturnType<typeof useToast>["notify"] }) {
  const [tasks, setTasks] = useState<TalaTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const load = useCallback(() => fetchTalaTasks().then(setTasks), []);
  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async () => {
    if (!title.trim()) return;
    const row = await addTalaTask({ title, due });
    if (row) {
      setTitle("");
      setDue("");
      notify("Task added.", "success");
      load();
    } else notify("Could not save task.", "error");
  }, [title, due, notify, load]);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-[#C6A15B]" />
        <p className="font-serif text-lg text-[#26221C]">Tasks</p>
      </div>
      <div className="mb-5 grid gap-2 md:grid-cols-[2fr_1fr_auto]">
        <Field label="Task">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Confirm 2pm airport pickup with Maria"
          />
        </Field>
        <Field label="Due (optional)">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button onClick={add} disabled={!title.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>
      {tasks === null ? (
        <p className="text-sm text-[#26221C]/45">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-[#26221C]/45">No tasks yet. Add this week's to-dos.</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-3 rounded-lg border border-[#26221C]/10 p-3"
            >
              {t.status === "done" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 text-[#C6A15B]" />
              )}
              <div>
                <p
                  className={`text-sm font-medium ${t.status === "done" ? "text-[#26221C]/45 line-through" : "text-[#26221C]"}`}
                >
                  {t.title}
                </p>
                <p className="text-[11px] text-[#26221C]/40">
                  {t.category}
                  {t.due ? ` · due ${t.due}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WINS — what TALA accomplished (logged manually now; auto later).
// ---------------------------------------------------------------------------
function WinsTab({
  cms,
  notify,
}: {
  cms: import("@/types/cms").CmsData;
  notify: ReturnType<typeof useToast>["notify"];
}) {
  const [wins, setWins] = useState<TalaWin[] | null>(null);
  const [text, setText] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(() => fetchTalaWins().then(setWins), []);
  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async () => {
    if (!text.trim()) return;
    const row = await addTalaWin({ brief_date: today, text });
    if (row) {
      setText("");
      notify("Win logged.", "success");
      load();
    } else notify("Could not save win.", "error");
  }, [text, today, notify, load]);

  // Reuse the brain to suggest a weekly summary if asked.
  const tala = useTalaChat();
  const live = useTalaLiveContext();
  const [digest, setDigest] = useState<string | null>(null);

  const summarize = useCallback(async () => {
    const list = wins ?? [];
    if (list.length === 0) {
      notify("No wins to summarise yet.", "info");
      return;
    }
    const prompt = `Summarise these accomplishments TALA achieved this period in 2-3 short bullet-style sentences for the owner:\n${list
      .map((w) => `- ${w.text}`)
      .join("\n")}`;
    setDigest(null);
    const out = await tala.send(prompt, withLiveContext(buildTalaSystemPrompt(cms), live.context), {
      model: cms.settings.tala.modelId || undefined,
      adminApiKey: cms.settings.tala.apiKey?.trim() || undefined,
      cms,
    });
    setDigest(out);
  }, [wins, tala, cms, live.context, notify]);

  return (
    <div>
      <Card className="mb-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-[#C6A15B]" />
          <p className="font-serif text-lg text-[#26221C]">Wins & accomplishments</p>
        </div>
        <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <Field label="What TALA accomplished">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Captured 4 qualified leads; flagged 2 unpaid departures"
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={add} disabled={!text.trim()}>
              <Plus className="h-4 w-4" /> Log win
            </Button>
          </div>
        </div>
        <Button variant="outline" onClick={summarize} disabled={tala.thinking}>
          {tala.thinking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Summarise with TALA
        </Button>
        {digest && (
          <p className="mt-3 rounded-lg bg-[#FAF6EF] p-3 text-sm text-[#26221C]">{digest}</p>
        )}
      </Card>

      <Card className="p-6">
        <p className="mb-3 font-serif text-lg text-[#26221C]">Recent wins</p>
        {wins === null ? (
          <p className="text-sm text-[#26221C]/45">Loading…</p>
        ) : wins.length === 0 ? (
          <p className="text-sm text-[#26221C]/45">No wins logged yet.</p>
        ) : (
          <div className="space-y-3">
            {wins.map((w) => (
              <div key={w.id} className="rounded-lg border border-[#26221C]/10 p-3">
                <p className="text-xs text-[#26221C]/45">{w.brief_date}</p>
                <p className="text-sm text-[#26221C]">{w.text}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LEADS — captured by TALA (guest chat + scraped). Owner follows up.
// Each lead has a one-tap WhatsApp link to reopen the conversation.
// (Inbound auto-reply / Baileys auto-send is a later phase.)
// ---------------------------------------------------------------------------
function LeadsTab({ cms }: { cms: import("@/types/cms").CmsData }) {
  const [leads, setLeads] = useState<TalaLead[] | null>(null);
  useEffect(() => {
    fetchTalaLeads().then(setLeads);
  }, []);
  const refresh = () => fetchTalaLeads().then(setLeads);

  const followUp = (lead: TalaLead) => {
    const href = buildLeadWhatsAppLink(lead, cms.settings.whatsapp);
    window.open(href, "_blank", "noreferrer");
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description="People TALA captured from guest chats and outreach. Follow up with one tap — WhatsApp opens pre-filled."
        actions={
          <Button variant="outline" onClick={refresh}>
            Refresh
          </Button>
        }
      />
      {leads === null ? (
        <p className="text-sm text-[#26221C]/45">Loading…</p>
      ) : leads.length === 0 ? (
        <p className="text-sm text-[#26221C]/45">
          No leads yet. They appear here when TALA captures a guest's name/contact or from outreach.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {leads.map((l) => (
            <div
              key={l.id}
              className="rounded-xl border border-[#26221C]/10 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-serif text-base text-[#26221C]">{l.name || "Unnamed lead"}</p>
                  <p className="text-xs text-[#26221C]/45">
                    {l.contact || "no contact"} · {l.source}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#C6A15B]/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#8A6443]">
                  {new Date(l.created_at).toLocaleDateString()}
                </span>
              </div>
              {l.note && <p className="mt-2 text-sm text-[#26221C]/70">{l.note}</p>}
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => followUp(l)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Follow up on WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
