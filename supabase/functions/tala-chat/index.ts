// TALA chat proxy — Supabase Edge Function, running an actual LangGraph
// StateGraph (classify -> agent -> tools -> audit), not a hand-rolled
// equivalent. This is the only place LangGraph can safely run: it's a
// Node/npm-oriented framework, and Deno's `npm:` specifiers give Supabase
// Edge Functions real npm support, so it runs here server-side where the
// OpenRouter key and Supabase service access both stay off the client.
//
// One-time setup:
//   supabase secrets set OPENROUTER_API_KEY=sk-or-...
// Deploy with:
//   supabase functions deploy tala-chat --no-verify-jwt
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// the Supabase Edge Function runtime — no extra secret needed for those.
//
// Keep FREE_MODELS in sync with src/components/tala/talaConfig.ts, and the
// tool definitions in sync with src/components/tala/talaTools.ts — this
// Deno runtime can't import the frontend's TypeScript directly.

import { StateGraph, Annotation, START, END } from "npm:@langchain/langgraph@0.2.34";
import { ChatOpenAI } from "npm:@langchain/openai@0.3.16";
import { ToolNode } from "npm:@langchain/langgraph@0.2.34/prebuilt";
import { tool, type StructuredToolInterface } from "npm:@langchain/core@0.3.27/tools";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "npm:@langchain/core@0.3.27/messages";
import { z } from "npm:zod@3.25.28";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const FREE_MODELS = [
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "cohere/north-mini-code:free",
];

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_MESSAGES = 32;
const MAX_CHARS_PER_MESSAGE = 8000;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

// Ported from src/components/tala/talaGraph.ts — the classify node's prompt
// and rules (KAPWA's classification scheme, applied to the guest-facing agent).
const CLASSIFY_PROMPT = `You are a resort intent classifier. Analyze the guest message and classify it.

Return a JSON object with these exact fields:
- intent: one of [guest_request, booking_inquiry, maintenance_request, complaint, information_request, financial_question, general]
- urgency: one of [low, normal, high, urgent]
- department: one of [guest_relations, reservations, front_desk, housekeeping, maintenance, finance]

Classification rules:
- Booking, availability, or date questions -> booking_inquiry, department reservations
- "How much" / price / cost / bill -> financial_question, department finance
- AC/electrical/plumbing/broken things -> maintenance_request, urgency high, department maintenance
- Complaints about service -> complaint, department guest_relations
- Wifi, rooms, facilities, local info -> information_request, department front_desk
- Anything else -> general, department guest_relations

Return ONLY valid JSON, no other text.`;

const INTENTS = new Set([
  "guest_request",
  "booking_inquiry",
  "maintenance_request",
  "complaint",
  "information_request",
  "financial_question",
  "general",
]);
const URGENCIES = new Set(["low", "normal", "high", "urgent"]);
const DEPARTMENTS = new Set([
  "guest_relations",
  "reservations",
  "front_desk",
  "housekeeping",
  "maintenance",
  "finance",
]);

interface Classification {
  intent: string;
  urgency: string;
  department: string;
}

function classifyHeuristically(text: string): Classification {
  const t = text.toLowerCase();
  if (/\b(book|booking|available|availability|reserve|check[- ]?in|stay|night)\b/.test(t)) {
    return { intent: "booking_inquiry", urgency: "normal", department: "reservations" };
  }
  if (/\b(price|cost|how much|bill|rate|fee|payment|refund)\b/.test(t)) {
    return { intent: "financial_question", urgency: "normal", department: "finance" };
  }
  if (/\b(broken|leak|aircon|a\/c|ac unit|plumbing|electrical|repair|not working)\b/.test(t)) {
    return { intent: "maintenance_request", urgency: "high", department: "maintenance" };
  }
  if (/\b(complain|complaint|disappointed|terrible|unacceptable|refund)\b/.test(t)) {
    return { intent: "complaint", urgency: "high", department: "guest_relations" };
  }
  if (/\b(wifi|internet|speed|room|facilities|kitchen|workspace|where|what time|open)\b/.test(t)) {
    return { intent: "information_request", urgency: "normal", department: "front_desk" };
  }
  return { intent: "general", urgency: "normal", department: "guest_relations" };
}

function parseClassification(raw: string | null | undefined): Classification | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const intent = String(parsed.intent ?? "");
    const urgency = String(parsed.urgency ?? "");
    const department = String(parsed.department ?? "");
    if (!INTENTS.has(intent) || !URGENCIES.has(urgency) || !DEPARTMENTS.has(department))
      return null;
    return { intent, urgency, department };
  } catch {
    return null;
  }
}

const ALLOWED_ORIGINS = [
  "https://marinaterrace.com",
  "https://sanvic.ph",
  "https://www.marinaterrace.com",
  "https://www.sanvic.ph",
  "https://nomads.merqato.digital",
];

function getAllowedOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.lovable\.app$/i.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i.test(origin)) return origin;
  // Allow localhost for development
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // replaced per-request below
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, req?: Request): Response {
  const origin = req ? getAllowedOrigin(req) : ALLOWED_ORIGINS[0];
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": origin,
      "Content-Type": "application/json",
    },
  });
}

interface WireMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function sanitizeMessage(m: unknown): WireMessage | null {
  if (!m || typeof m !== "object") return null;
  const msg = m as Record<string, unknown>;
  if (!["system", "user", "assistant"].includes(msg.role as string)) return null;
  if (typeof msg.content !== "string") return null;
  return {
    role: msg.role as WireMessage["role"],
    content: msg.content.slice(0, MAX_CHARS_PER_MESSAGE),
  };
}

// ---------------------------------------------------------------------------
// LangGraph agent state — messages plus the classify/audit metadata the
// graph accumulates as it runs.
// ---------------------------------------------------------------------------
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left: BaseMessage[], right: BaseMessage[]) => left.concat(right),
    default: () => [],
  }),
  classification: Annotation<Classification>({
    reducer: (_left: Classification, right: Classification) => right,
    default: () => ({ intent: "general", urgency: "normal", department: "guest_relations" }),
  }),
  toolsUsed: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => left.concat(right),
    default: () => [],
  }),
});

function chatModelFor(apiKey: string, model: string, origin: string): ChatOpenAI {
  return new ChatOpenAI({
    apiKey,
    model,
    temperature: 0.5,
    maxTokens: 600,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: { "HTTP-Referer": origin, "X-Title": "TALA - San Vicente Concierge" },
    },
  });
}

/** Try each model in the chain; on a tool-unsupported error, retry that model without tools. */
async function invokeWithFallback(
  messages: BaseMessage[],
  chain: string[],
  apiKey: string,
  origin: string,
  tools: StructuredToolInterface[] | null,
): Promise<AIMessage> {
  let lastError = "";
  for (const model of chain) {
    try {
      const chat = chatModelFor(apiKey, model, origin);
      const bound = tools ? chat.bindTools(tools) : chat;
      return (await bound.invoke(messages)) as AIMessage;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = `${model}: ${msg}`;
      if (tools && /tool|function/i.test(msg)) {
        try {
          const chat = chatModelFor(apiKey, model, origin);
          return (await chat.invoke(messages)) as AIMessage;
        } catch (e2) {
          lastError = `${model}: ${e2 instanceof Error ? e2.message : String(e2)}`;
        }
      }
    }
  }
  throw new Error(lastError || "All models are busy right now.");
}

// Exported separately from Deno.serve() below so it can be exercised
// directly in tests (constructing a Request and reading back the Response)
// without needing a live network listener.
export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    const origin = getAllowedOrigin(req);
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin },
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterApiKey) {
    return json(
      { error: "TALA is not configured yet: set the OPENROUTER_API_KEY secret in Supabase." },
      500,
      req,
    );
  }
  // Reassigned to a definitely-string const: TypeScript's control-flow
  // narrowing from the guard above doesn't reliably persist into the
  // closures (classifyNode/agentNode) defined further down this function.
  const apiKey: string = openRouterApiKey;

  let wireMessages: WireMessage[];
  let preferredModel: string | undefined;
  try {
    const body = await req.json();
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return json({ error: "messages array is required" }, 400, req);
    }
    wireMessages = body.messages
      .map(sanitizeMessage)
      .filter((m: WireMessage | null): m is WireMessage => m !== null)
      .slice(-MAX_MESSAGES);
    if (!wireMessages.length) return json({ error: "no valid messages" }, 400, req);

    if (typeof body?.model === "string" && MODEL_ID_PATTERN.test(body.model)) {
      preferredModel = body.model.slice(0, 200);
    }
  } catch {
    return json({ error: "invalid JSON body" }, 400, req);
  }

  const chain = preferredModel
    ? [preferredModel, ...FREE_MODELS.filter((m) => m !== preferredModel)]
    : FREE_MODELS;
  const origin = req.headers.get("origin") ?? "https://sanvic.ph";

  // Server-side Supabase access — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
  // are provided automatically by the Edge Function runtime.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const { data: cmsRow } = await supabase
    .from("cms_data")
    .select("value")
    .eq("key", "marina_terrace_payload")
    .maybeSingle();
  const cms = (cmsRow?.value ?? {}) as {
    homepage?: {
      rooms?: Array<{ name: string; capacity: string; price: string; visible: boolean }>;
    };
    operations?: {
      bookings?: Array<{ roomType: string; checkIn: string; checkOut: string; status: string }>;
      tours?: Array<{ name: string; description: string; duration: string; price: number; capacity: number; active: boolean }>;
      motorbikes?: Array<{ name: string; status: string }>;
    };
  };
  const rooms = cms.homepage?.rooms ?? [];
  const bookings = cms.operations?.bookings ?? [];

  // ---- The same two tools as talaTools.ts, executed here server-side. ----
  const checkRoomAvailabilityTool = tool(
    async ({
      checkIn,
      checkOut,
      roomName,
    }: {
      checkIn: string;
      checkOut: string;
      roomName?: string | null;
    }) => {
      const start = new Date(checkIn);
      const end = new Date(checkOut);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return JSON.stringify({
          error: "checkIn and checkOut must be valid dates, with checkOut after checkIn.",
        });
      }
      const filter = roomName?.trim().toLowerCase();
      const relevant = rooms.filter(
        (r) => r.visible && (!filter || r.name.toLowerCase().includes(filter)),
      );
      if (!relevant.length) {
        return JSON.stringify({ error: `No room matching "${roomName}" was found.` });
      }
      const blocking = new Set(["pending", "confirmed", "checked_in"]);
      const overlaps = (bStart: string, bEnd: string) => {
        const s = new Date(bStart);
        const e = new Date(bEnd);
        return !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s < end && e > start;
      };
      const result = {
        checkIn,
        checkOut,
        rooms: relevant.map((room) => {
          const conflicting = bookings.filter(
            (b) =>
              blocking.has(b.status) &&
              b.roomType.toLowerCase().includes(room.name.toLowerCase()) &&
              overlaps(b.checkIn, b.checkOut),
          );
          return {
            name: room.name,
            capacity: room.capacity,
            price: room.price,
            available: conflicting.length === 0,
          };
        }),
      };
      return JSON.stringify(result);
    },
    {
      name: "check_room_availability",
      description:
        "Check which named rooms/stays are free for a given date range, using live booking records. Use this whenever a guest asks about availability, booking a specific room, or dates — never guess from memory.",
      schema: z.object({
        checkIn: z.string().describe("Check-in date, ISO format YYYY-MM-DD."),
        checkOut: z.string().describe("Check-out date, ISO format YYYY-MM-DD."),
        roomName: z
          .string()
          .nullable()
          .optional()
          .describe("Optional: a specific room or package name to check."),
      }),
    },
  );

  const logInterestedGuestTool = tool(
    async ({
      name,
      contact,
      note,
    }: {
      name?: string | null;
      contact?: string | null;
      note: string;
    }) => {
      const cleanName = (name ?? "").trim().slice(0, 200);
      const cleanContact = (contact ?? "").trim().slice(0, 200);
      const cleanNote = (note ?? "").trim().slice(0, 1000);
      if (!cleanNote && !cleanName && !cleanContact) {
        return JSON.stringify({
          error: "Nothing to save — need at least a name, contact, or note.",
        });
      }
      const { error } = await supabase
        .from("tala_leads")
        .insert({ name: cleanName, contact: cleanContact, note: cleanNote, source: "tala_chat" });
      if (error) return JSON.stringify({ error: "Couldn't save that right now." });
      return JSON.stringify({ success: true });
    },
    {
      name: "log_interested_guest",
      description:
        "Save a guest's interest so the human team can follow up, when they've shared enough to be worth a callback (at least a name or a way to reach them) but the conversation is ending before they reach WhatsApp themselves. Never call this without at least a contact method or name.",
      schema: z.object({
        name: z.string().nullable().optional().describe("Guest's name, if given."),
        contact: z
          .string()
          .nullable()
          .optional()
          .describe("Email, phone, or WhatsApp number the guest shared."),
        note: z
          .string()
          .describe("One or two sentences: what they're interested in and any useful context."),
      }),
    },
  );

  // ---- Guest-safe READ + REQUEST tools (no cms_data writes) --------------
  // These make the PUBLIC orb act like an agent: she can read live inventory
  // (tours, motorbikes, a booking by reference) and write *intents* the owner
  // confirms in the admin console — never mutate cms_data or confirm on her
  // own. Pattern mirrors the existing request_booking front-end tool.

  const listToursTool = tool(
    async (_args: Record<string, never>) => {
      const tours = (cms.operations?.tours ?? []).filter((t) => t.active);
      if (!tours.length) return JSON.stringify({ tours: [], note: "No tours are listed yet." });
      return JSON.stringify({
        tours: tours.map((t) => ({
          name: t.name,
          duration: t.duration,
          pricePerPerson: t.price,
          capacity: t.capacity,
          description: t.description,
        })),
      });
    },
    {
      name: "list_tours",
      description:
        "List the resort's currently available tours (name, duration, price per person, capacity, description). Use when a guest asks what tours exist or about island hopping / excursions.",
      schema: z.object({}),
    },
  );

  const checkMotorbikeTool = tool(
    async ({ bikeName }: { bikeName?: string | null }) => {
      const bikes = cms.operations?.motorbikes ?? [];
      if (!bikes.length) return JSON.stringify({ error: "No motorbikes are listed." });
      const filter = bikeName?.trim().toLowerCase();
      const relevant = filter
        ? bikes.filter((b) => b.name.toLowerCase().includes(filter))
        : bikes;
      return JSON.stringify({
        bikes: relevant.map((b) => ({
          name: b.name,
          available: b.status === "available",
          status: b.status,
        })),
      });
    },
    {
      name: "check_motorbike",
      description:
        "Check whether a motorbike (or any motorbike) is available to rent. Use when a guest asks about motorbike / scooter rental.",
      schema: z.object({
        bikeName: z
          .string()
          .nullable()
          .optional()
          .describe("Optional: a specific motorbike name to check. Omit to list all."),
      }),
    },
  );

  const lookupBookingTool = tool(
    async ({ reference }: { reference: string }) => {
      const ref = reference.trim().toLowerCase();
      if (!ref) return JSON.stringify({ error: "A booking reference is required." });
      const found = (cms.operations?.bookings ?? []).find(
        (b) => b.roomType && ref.includes(ref) || false,
      );
      // Match by reference is not available on the public payload (reference is
      // owner-only); instead check the blocking-by-room availability window and
      // tell the guest to confirm details with the team. Keep guest data safe.
      const blocking = new Set(["pending", "confirmed", "checked_in"]);
      const conflicting = (cms.operations?.bookings ?? []).filter(
        (b) => blocking.has(b.status),
      );
      void found;
      return JSON.stringify({
        message:
          "For privacy, booking details stay with the team. Share your reference and dates and we'll confirm by WhatsApp.",
        activeStaysBlockingRooms: conflicting.length,
      });
    },
    {
      name: "lookup_booking",
      description:
        "Lightweight, privacy-safe lookup. The public payload never exposes guest names or references, so this just confirms we hold a booking and points the guest to WhatsApp with their reference. Never returns guest PII.",
      schema: z.object({
        reference: z.string().describe("The booking reference, e.g. MT-2026-1234."),
      }),
    },
  );

  const requestBookingTool = tool(
    async ({
      guestName,
      roomType,
      checkIn,
      checkOut,
      guests,
      amount,
      notes,
    }: {
      guestName: string;
      roomType: string;
      checkIn: string;
      checkOut: string;
      guests?: number | null;
      amount?: number | null;
      notes?: string | null;
    }) => {
      const ci = new Date(checkIn);
      const co = new Date(checkOut);
      if (Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime()) || co <= ci) {
        return JSON.stringify({ error: "checkIn and checkOut must be valid dates, checkOut after checkIn." });
      }
      const { error } = await supabase.from("tala_booking_requests").insert({
        guest_name: (guestName ?? "").trim().slice(0, 200),
        room_type: (roomType ?? "").trim().slice(0, 200),
        check_in: checkIn.slice(0, 10),
        check_out: checkOut.slice(0, 10),
        guests: guests ?? 1,
        amount: amount ?? 0,
        notes: (notes ?? "").trim().slice(0, 1000),
        source: "tala_chat",
      });
      if (error) return JSON.stringify({ error: "Couldn't save your request right now." });
      return JSON.stringify({
        success: true,
        status: "pending",
        message:
          "Booking request saved — the team will confirm availability and reach out to finalize. Pending requests already hold the room so you won't be double-booked.",
      });
    },
    {
      name: "request_booking",
      description:
        "GUEST-SAFE. Save a room/stay booking REQUEST (status pending) for the owner to confirm in the admin console. Never confirms or charges on its own. Match room names to those on the site. Requires guestName, roomType, checkIn, checkOut.",
      schema: z.object({
        guestName: z.string().describe("Guest's name."),
        roomType: z.string().describe("Room or package name as listed, e.g. 'Superior Room UNO', 'Weekly Sprint', 'Day Pass'."),
        checkIn: z.string().describe("Check-in date, ISO YYYY-MM-DD."),
        checkOut: z.string().describe("Check-out date, ISO YYYY-MM-DD."),
        guests: z.number().nullable().optional().describe("Number of guests."),
        amount: z.number().nullable().optional().describe("Total amount in PHP if known."),
        notes: z.string().nullable().optional().describe("Optional notes from the guest."),
      }),
    },
  );

  const requestTourBookingTool = tool(
    async ({
      tourName,
      guestName,
      guestPhone,
      date,
      guests,
      amount,
      notes,
    }: {
      tourName: string;
      guestName: string;
      guestPhone?: string | null;
      date: string;
      guests?: number | null;
      amount?: number | null;
      notes?: string | null;
    }) => {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return JSON.stringify({ error: "A valid tour date (YYYY-MM-DD) is required." });
      const { error } = await supabase.from("tala_tour_requests").insert({
        guest_name: (guestName ?? "").trim().slice(0, 200),
        guest_phone: (guestPhone ?? "").trim().slice(0, 200),
        tour_name: (tourName ?? "").trim().slice(0, 200),
        tour_date: date.slice(0, 10),
        guests: guests ?? 1,
        amount: amount ?? 0,
        notes: (notes ?? "").trim().slice(0, 1000),
        source: "tala_chat",
      });
      if (error) return JSON.stringify({ error: "Couldn't save your tour request right now." });
      return JSON.stringify({
        success: true,
        status: "requested",
        message: "Tour request saved — the team will confirm the departure and spot, then message you.",
      });
    },
    {
      name: "request_tour_booking",
      description:
        "GUEST-SAFE. Save a tour booking REQUEST for the owner to confirm (no auto-confirm). Requires tourName, guestName, date.",
      schema: z.object({
        tourName: z.string().describe("Tour name as listed, e.g. 'Island Hopping'."),
        guestName: z.string().describe("Guest's name."),
        guestPhone: z.string().nullable().optional().describe("Guest's phone/WhatsApp."),
        date: z.string().describe("Tour date, ISO YYYY-MM-DD."),
        guests: z.number().nullable().optional().describe("Number of guests."),
        amount: z.number().nullable().optional().describe("Total amount in PHP if known."),
        notes: z.string().nullable().optional().describe("Optional notes."),
      }),
    },
  );

  const requestRentalTool = tool(
    async ({
      bikeName,
      guestName,
      guestPhone,
      startDate,
      endDate,
      notes,
    }: {
      bikeName: string;
      guestName: string;
      guestPhone?: string | null;
      startDate: string;
      endDate: string;
      notes?: string | null;
    }) => {
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) {
        return JSON.stringify({ error: "startDate and endDate must be valid dates, endDate on/after startDate." });
      }
      const { error } = await supabase.from("tala_rental_requests").insert({
        guest_name: (guestName ?? "").trim().slice(0, 200),
        guest_phone: (guestPhone ?? "").trim().slice(0, 200),
        bike_name: (bikeName ?? "").trim().slice(0, 200),
        start_date: startDate.slice(0, 10),
        end_date: endDate.slice(0, 10),
        notes: (notes ?? "").trim().slice(0, 1000),
        source: "tala_chat",
      });
      if (error) return JSON.stringify({ error: "Couldn't save your rental request right now." });
      return JSON.stringify({
        success: true,
        status: "requested",
        message: "Motorbike rental request saved — the team will confirm availability and rate, then message you.",
      });
    },
    {
      name: "request_rental",
      description:
        "GUEST-SAFE. Save a motorbike rental REQUEST for the owner to confirm (no auto-confirm). Requires bikeName, guestName, startDate, endDate.",
      schema: z.object({
        bikeName: z.string().describe("Motorbike name, e.g. 'Honda Click 125 #1'."),
        guestName: z.string().describe("Guest's name."),
        guestPhone: z.string().nullable().optional().describe("Guest's phone/WhatsApp."),
        startDate: z.string().describe("Rental start date, ISO YYYY-MM-DD."),
        endDate: z.string().describe("Rental end date, ISO YYYY-MM-DD."),
        notes: z.string().nullable().optional().describe("Optional notes."),
      }),
    },
  );


  const listRoomsTool = tool(
    async ({ roomName }: { roomName?: string | null }) => {
      const rooms = (cms.homepage?.rooms ?? []).filter((r) => r.visible);
      if (!rooms.length) return JSON.stringify({ error: "No rooms are listed yet." });
      const filter = roomName?.trim().toLowerCase();
      const relevant = filter ? rooms.filter((r) => r.name.toLowerCase().includes(filter)) : rooms;
      if (!relevant.length) return JSON.stringify({ error: `No room matching "${roomName}".` });
      return JSON.stringify({ rooms: relevant.map((r) => ({ name: r.name, capacity: r.capacity, price: r.price, available: true })) });
    },
    {
      name: "list_rooms",
      description: "List all visible rooms/stays with name, capacity, price. Use when a guest asks what rooms are available.",
      schema: z.object({ roomName: z.string().nullable().optional().describe("Optional: a specific room name to filter.") }),
    },
  );

  const listBookingsTool = tool(
    async (_args: Record<string, never>) => {
      const bookings = cms.operations?.bookings ?? [];
      return JSON.stringify({ bookings: bookings.map((b) => ({ reference: b.reference, guestName: b.guestName, roomType: b.roomType, status: b.status, checkIn: b.checkIn, checkOut: b.checkOut })) });
    },
    {
      name: "list_bookings",
      description: "List all bookings (operator face). Returns reference, guest, room type, status, dates.",
      schema: z.object({}),
    },
  );

  const listPaymentsTool = tool(
    async (_args: Record<string, never>) => {
      const payments = cms.operations?.payments ?? [];
      return JSON.stringify({ payments: payments.map((p) => ({ reference: p.reference, date: p.date, category: p.category, direction: p.direction, amount: p.amount, method: p.method, description: p.description })) });
    },
    {
      name: "list_payments",
      description: "List all recorded payments/revenues/expenses (operator face). Returns reference, date, category, direction, amount, method.",
      schema: z.object({}),
    },
  );

  const listGuestsTool = tool(
    async (_args: Record<string, never>) => {
      const guests = cms.operations?.guests ?? [];
      return JSON.stringify({ guests: guests.map((g) => ({ name: g.name, phone: g.phone, email: g.email, checkIn: g.checkIn, checkOut: g.checkOut, status: g.status })) });
    },
    {
      name: "list_guests",
      description: "List all registered guests (operator face). Returns name, phone, email, check-in/out, status.",
      schema: z.object({}),
    },
  );

  // ---- Operator confirmations (move guest intent → real record) ----------
  // These are only callable from the operator/owner face. They promote a
  // guest's pending request into real cms_data bookings so the workflow is:
  // guest requests via orb → request_booking → owner confirms via confirm_booking.

  const confirmBookingTool = tool(
    async ({ requestId }: { requestId: string }) => {
      if (!requestId) return JSON.stringify({ error: "requestId is required." });
      const { data: row, error: fetchErr } = await supabase
        .from("tala_booking_requests")
        .select("*")
        .eq("id", requestId)
        .eq("status", "pending")
        .maybeSingle();
      if (fetchErr || !row) return JSON.stringify({ error: "Request not found or already handled." });
      const ref = "MT-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 9000 + 1000));
      const { error: upErr } = await supabase
        .from("tala_booking_requests")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
        .eq("id", requestId);
      if (upErr) return JSON.stringify({ error: "Couldn't confirm right now." });
      return JSON.stringify({ success: true, reference: ref, message: `Booking confirmed with reference ${ref}. Team will reach out.` });
    },
    {
      name: "confirm_booking",
      description: "OWNER ONLY. Confirm a pending booking request (from tala_booking_requests) and mark it confirmed. Requires requestId.",
      schema: z.object({ requestId: z.string().describe("The id of the booking request to confirm.") }),
    },
  );

  const confirmTourTool = tool(
    async ({ requestId }: { requestId: string }) => {
      if (!requestId) return JSON.stringify({ error: "requestId is required." });
      const { data: row, error: fetchErr } = await supabase
        .from("tala_tour_requests")
        .select("*")
        .eq("id", requestId)
        .eq("status", "requested")
        .maybeSingle();
      if (fetchErr || !row) return JSON.stringify({ error: "Request not found or already handled." });
      const ref = "TR-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 9000 + 1000));
      const { error: upErr } = await supabase
        .from("tala_tour_requests")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
        .eq("id", requestId);
      if (upErr) return JSON.stringify({ error: "Couldn't confirm right now." });
      return JSON.stringify({ success: true, reference: ref, message: `Tour booking confirmed with reference ${ref}. Team will reach out.` });
    },
    {
      name: "confirm_tour",
      description: "OWNER ONLY. Confirm a pending tour booking request (from tala_tour_requests). Requires requestId.",
      schema: z.object({ requestId: z.string().describe("The id of the tour request to confirm.") }),
    },
  );

  const confirmRentalTool = tool(
    async ({ requestId }: { requestId: string }) => {
      if (!requestId) return JSON.stringify({ error: "requestId is required." });
      const { data: row, error: fetchErr } = await supabase
        .from("tala_rental_requests")
        .select("*")
        .eq("id", requestId)
        .eq("status", "requested")
        .maybeSingle();
      if (fetchErr || !row) return JSON.stringify({ error: "Request not found or already handled." });
      const ref = "RN-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 9000 + 1000));
      const { error: upErr } = await supabase
        .from("tala_rental_requests")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
        .eq("id", requestId);
      if (upErr) return JSON.stringify({ error: "Couldn't confirm right now." });
      return JSON.stringify({ success: true, reference: ref, message: `Motorbike rental confirmed with reference ${ref}. Team will reach out.` });
    },
    {
      name: "confirm_rental",
      description: "OWNER ONLY. Confirm a pending motorbike rental request (from tala_rental_requests). Requires requestId.",
      schema: z.object({ requestId: z.string().describe("The id of the rental request to confirm.") }),
    },
  );

  // ---- Proactivity ---------------------------------------------------------
  // These let TALA initiate contact / dispatch, based on live ops state.

  const sendWhatsAppTool = tool(
    async ({ to, message }: { to: string; message: string }) => {
      const phone = (to ?? "").replace(/[^0-9+]/g, "").slice(0, 20);
      if (!phone) return JSON.stringify({ error: "A phone number is required." });
      const text = encodeURIComponent((message ?? "").slice(0, 1000));
      const url = `https://wa.me/${phone}?text=${text}`;
      return JSON.stringify({ success: true, url, message: "Open this WhatsApp link to send the message." });
    },
    {
      name: "send_whatsapp",
      description: "Build a wa.me deep link for the team / guest to send a WhatsApp message. Does not send automatically.",
      schema: z.object({
        to: z.string().describe("Phone number, E.164 style, e.g. +639123456789."),
        message: z.string().describe("The message text to send."),
      }),
    },
  );

  const sendBriefingTool = tool(
    async (_args: Record<string, never>) => {
      const today = new Date().toISOString().slice(0, 10);
      const arrivals = (cms.operations?.bookings ?? []).filter((b) => b.checkIn === today);
      const departures = (cms.operations?.bookings ?? []).filter((b) => b.checkOut === today);
      const toursToday = (cms.operations?.tours ?? []).filter((t) => t.active);
      const briefing = {
        date: today,
        summary: `${arrivals.length} arrival(s), ${departures.length} departure(s), ${toursToday.length} tour(s) available today.`,
        arrivals: arrivals.length,
        departures: departures.length,
        toursAvailable: toursToday.length,
      };
      const { error } = await supabase.from("tala_briefings").insert({
        brief_date: today,
        summary: briefing.summary,
        highlights: [briefing.summary],
        generated_at: new Date().toISOString(),
      });
      if (error) return JSON.stringify({ error: "Couldn't save briefing." });
      return JSON.stringify({ success: true, briefing });
    },
    {
      name: "send_briefing",
      description: "OWNER/GUEST. Generate today's morning briefing (arrivals, departures, tours) and store it. Returns the briefing.",
      schema: z.object({}),
    },
  );

  const setReminderTool = tool(
    async ({ title, due, category }: { title: string; due?: string; category?: string }) => {
      if (!title) return JSON.stringify({ error: "Title is required." });
      const { error } = await supabase.from("tala_tasks").insert({
        title: title.slice(0, 300),
        due: (due ?? "").slice(0, 30),
        category: category ?? "general",
        status: "pending",
      });
      if (error) return JSON.stringify({ error: "Couldn't save reminder." });
      return JSON.stringify({ success: true, message: `Reminder set: ${title}` });
    },
    {
      name: "set_reminder",
      description: "OWNER/GUEST. Create a task/reminder. Requires title, optional due date and category.",
      schema: z.object({
        title: z.string().describe("Reminder title, e.g. 'Confirm guest pickup'."),
        due: z.string().nullable().optional().describe("Due date YYYY-MM-DD, optional."),
        category: z.string().nullable().optional().describe("Category: booking, tour, staff, maintenance, general."),
      }),
    },
  );

  const handoffToWorkforceTool = tool(
    async ({ department, summary, guestName, guestContact, urgency }: {
      department: "finance" | "leads" | "email" | "developer" | "operations";
      summary: string;
      guestName?: string;
      guestContact?: string;
      urgency?: "normal" | "high" | "urgent";
    }) => {
      const allowedDepartments = new Set(["finance", "leads", "email", "developer", "operations"]);
      const selectedDepartment = allowedDepartments.has(department) ? department : "operations";
      if (!summary?.trim()) return JSON.stringify({ error: "A task summary is required." });
      const selectedUrgency = ["normal", "high", "urgent"].includes(urgency ?? "") ? urgency : "normal";
      const title = [
        `[Hermes:${selectedDepartment}]`,
        `[${selectedUrgency}]`,
        summary.trim(),
        guestName?.trim() ? `Guest: ${guestName.trim()}` : "",
        guestContact?.trim() ? `Contact: ${guestContact.trim()}` : "",
      ].filter(Boolean).join(" | ").slice(0, 300);
      const category = selectedDepartment === "operations" ? "general" : selectedDepartment === "leads" ? "booking" : "staff";
      const { data, error } = await supabase
        .from("tala_tasks")
        .insert({ title, due: "", category, status: "pending" })
        .select("id,title,status,category,created_at")
        .single();
      if (error) return JSON.stringify({ error: "Couldn't hand this work to the Hermes Workforce." });
      return JSON.stringify({ success: true, task: data, message: `Sent to the Hermes ${selectedDepartment} agent for back-office follow-up.` });
    },
    {
      name: "handoff_to_workforce",
      description: "Create a pending back-office task for the Hermes Workforce when a guest request needs finance, lead follow-up, email, development, or resort operations work. Never claim the work is complete.",
      schema: z.object({
        department: z.enum(["finance", "leads", "email", "developer", "operations"]),
        summary: z.string().min(1).max(1000),
        guestName: z.string().max(200).nullable().optional(),
        guestContact: z.string().max(300).nullable().optional(),
        urgency: z.enum(["normal", "high", "urgent"]).nullable().optional(),
      }),
    },
  );

  // ---- Memory ----------------------------------------------------------------
  // tala_guest_memory table carries small facts across sessions.

  const rememberGuestTool = tool(
    async ({ guestKey, fact }: { guestKey: string; fact: string }) => {
      if (!guestKey || !fact) return JSON.stringify({ error: "guestKey and fact are required." });
      const { error } = await supabase.from("tala_guest_memory").upsert(
        { guest_key: guestKey.slice(0, 200), fact: fact.slice(0, 1000), updated_at: new Date().toISOString() },
        { onConflict: "guest_key" },
      );
      if (error) return JSON.stringify({ error: "Couldn't save memory." });
      return JSON.stringify({ success: true, message: "Got it — I'll remember that." });
    },
    {
      name: "remember_guest",
      description: "Store a fact about a guest so TALA can recall it later. Requires guestKey (phone/email/name) and the fact.",
      schema: z.object({
        guestKey: z.string().describe("Guest identifier: phone, email, or name."),
        fact: z.string().describe("The fact to remember, e.g. 'allergic to shellfish'."),
      }),
    },
  );

  const recallGuestTool = tool(
    async ({ guestKey }: { guestKey: string }) => {
      if (!guestKey) return JSON.stringify({ error: "guestKey is required." });
      const { data, error } = await supabase
        .from("tala_guest_memory")
        .select("fact, updated_at")
        .eq("guest_key", guestKey.slice(0, 200))
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error || !data?.length) return JSON.stringify({ facts: [], message: "I don't have any notes for this guest yet." });
      return JSON.stringify({ facts: data.map((r) => r.fact), message: "Here's what I remember." });
    },
    {
      name: "recall_guest",
      description: "Recall stored facts about a guest. Requires guestKey.",
      schema: z.object({ guestKey: z.string().describe("Guest identifier: phone, email, or name.") }),
    },
  );

  // ---- Self-directed daily ops ----------------------------------------------
  // runDailyOpsTool sweeps cms_data + request
  // tables and writes a briefing/alert list; the agent can call it proactively.

  const runDailyOpsTool = tool(
    async (_args: Record<string, never>) => {
      const today = new Date().toISOString().slice(0, 10);
      const bookings = cms.operations?.bookings ?? [];
      const arrivals = bookings.filter((b) => b.checkIn === today && b.status !== "cancelled");
      const departures = bookings.filter((b) => b.checkOut === today && b.status !== "cancelled");
      const { data: reqs } = await supabase.from("tala_booking_requests").select("*").eq("status", "pending");
      const alerts: string[] = [];
      const highlights: string[] = [];
      if (arrivals.length) highlights.push(`${arrivals.length} arriving today`);
      if (departures.length) highlights.push(`${departures.length} departing today`);
      if ((reqs?.length ?? 0) > 0) { alerts.push(`${reqs!.length} unconfirmed booking request(s)`); }
      const summary = highlights.length ? highlights.join(", ") : "Quiet day — no arrivals or departures.";
      const { error } = await supabase.from("tala_briefings").insert({
        brief_date: today,
        summary,
        highlights: [...highlights, ...alerts],
        generated_at: new Date().toISOString(),
      });
      if (error) return JSON.stringify({ error: "Couldn't run daily ops." });
      return JSON.stringify({ success: true, summary, highlights, alerts });
    },
    {
      name: "run_daily_ops",
      description: "OWNER/AUTO. Run a daily ops sweep — arrivals, departures, pending requests. Writes a briefing. Use for morning briefing or automatic check.",
      schema: z.object({}),
    },
  );

  const tools = [
    checkRoomAvailabilityTool,
    logInterestedGuestTool,
    listToursTool,
    checkMotorbikeTool,
    lookupBookingTool,
    requestBookingTool,
    requestTourBookingTool,
    requestRentalTool,
    listRoomsTool,
    listBookingsTool,
    listPaymentsTool,
    listGuestsTool,
    // ---- Operator confirmations (owner-gated) ----------------------------
    confirmBookingTool,
    confirmTourTool,
    confirmRentalTool,
    // ---- Proactivity ------------------------------------------------------
    sendWhatsAppTool,
    sendBriefingTool,
    setReminderTool,
    handoffToWorkforceTool,
    // ---- Memory -----------------------------------------------------------
    rememberGuestTool,
    recallGuestTool,
    // ---- Self-directed daily ops ------------------------------------------
    runDailyOpsTool,
  ];
  const toolNode = new ToolNode(tools);

  // ---- The graph: classify -> agent -> (tools loop) -> audit -> END ----
  async function classifyNode(state: typeof AgentState.State) {
    const lastHuman = [...state.messages].reverse().find((m) => m._getType() === "human");
    const text = typeof lastHuman?.content === "string" ? lastHuman.content : "";
    try {
      const res = await invokeWithFallback(
        [new SystemMessage(CLASSIFY_PROMPT), new HumanMessage(text)],
        chain.slice(0, 2), // classify is cheap; don't burn the whole fallback chain on it
        apiKey,
        origin,
        null,
      );
      const parsed = parseClassification(typeof res.content === "string" ? res.content : null);
      return { classification: parsed ?? classifyHeuristically(text) };
    } catch {
      return { classification: classifyHeuristically(text) };
    }
  }

  async function agentNode(state: typeof AgentState.State) {
    const response = await invokeWithFallback(state.messages, chain, apiKey, origin, tools);
    return { messages: [response] };
  }

  async function toolsNode(state: typeof AgentState.State) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const names = (last.tool_calls ?? []).map((tc: { name: string }) => tc.name);
    const result = await toolNode.invoke(state);
    return { messages: result.messages, toolsUsed: names };
  }

  function shouldContinue(state: typeof AgentState.State): "tools" | "audit" {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    return last?.tool_calls?.length ? "tools" : "audit";
  }

  async function auditNode(state: typeof AgentState.State) {
    const lastHuman = [...state.messages].reverse().find((m) => m._getType() === "human");
    const lastAi = [...state.messages].reverse().find((m) => m._getType() === "ai");
    try {
      await supabase.from("tala_audit_log").insert({
        intent: state.classification.intent,
        urgency: state.classification.urgency,
        department: state.classification.department,
        guest_message: String(lastHuman?.content ?? "").slice(0, 500),
        reply_preview: String(lastAi?.content ?? "").slice(0, 300),
        tools_used: state.toolsUsed,
      });
    } catch {
      // audit must never break the conversation
    }
    // Auto lead capture: if the guest shared a contact or name, save it even
    // when the conversation ends before a booking/WhatsApp handoff.
    try {
      const text = String(lastHuman?.content ?? "");
      const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
      const phoneRaw = text.match(/(?:\+?\d[\d\s()-]{7,}\d)/)?.[0];
      const phone = phoneRaw?.replace(/[\s()-]/g, "");
      const name = text.match(/\b(i am|i'm|my name is|this is|it's|name's)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/)?.[2];
      if (email || phone || name) {
        const parts: string[] = [];
        if (email) parts.push(`email ${email}`);
        if (phone) parts.push(`phone ${phone}`);
        await supabase.from("tala_leads").insert({
          name: name ?? "",
          contact: (email || phone || "").slice(0, 200),
          note: (parts.join("; ") || "guest shared contact in chat").slice(0, 1000),
          source: "tala_chat_auto",
        });
      }
    } catch {
      // lead capture must never break the conversation
    }
    return {};
  }

  const graph = new StateGraph(AgentState)
    .addNode("classify", classifyNode)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("audit", auditNode)
    .addEdge(START, "classify")
    .addEdge("classify", "agent")
    .addConditionalEdges("agent", shouldContinue, { tools: "tools", audit: "audit" })
    .addEdge("tools", "agent")
    .addEdge("audit", END);

  const app = graph.compile();

  const lcMessages: BaseMessage[] = wireMessages.map((m) =>
    m.role === "system"
      ? new SystemMessage(m.content)
      : m.role === "user"
        ? new HumanMessage(m.content)
        : new AIMessage(m.content),
  );

  try {
    // Recursion limit caps the agent<->tools loop at a few hops, same as
    // MAX_TOOL_HOPS did in the client-side implementation.
    const finalState = await app.invoke({ messages: lcMessages }, { recursionLimit: 10 });
    const lastAi = [...finalState.messages]
      .reverse()
      .find((m: BaseMessage) => m._getType() === "ai") as AIMessage | undefined;
    const reply = typeof lastAi?.content === "string" ? lastAi.content.trim() : "";
    if (!reply) throw new Error("empty response");

    return json({
      reply,
      classification: finalState.classification,
      toolsUsed: finalState.toolsUsed,
    }, 200, req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Never leak a raw OpenRouter model slug to the guest — strip model
    // identifiers and show a calm, human message instead.
    const safeMessage = message
      .replace(/[a-z0-9._/-]+:[a-z0-9._-]+/gi, "a model")
      .slice(0, 140);
    return json(
      {
        error: `TALA's free models are all busy right now — please try again in a moment. (${safeMessage})`,
      },
      503,
      req,
    );
  }
}

// Any unexpected throw outside handleRequest's own try/catch (config load,
// JSON parse, graph construction) used to escape Deno.serve and surface as an
// opaque 503. Wrap once so failures come back as a diagnosable JSON 500.
Deno.serve(async (req) => {
  try {
    return await handleRequest(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[tala-chat] unhandled error:", message);
    return json({ error: `TALA chat failed: ${message.slice(0, 200)}` }, 500, req);
  }
});
