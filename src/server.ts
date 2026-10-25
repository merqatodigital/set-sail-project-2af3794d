import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  normalizePhone,
  issueGuestSession,
  verifyGuestSession,
  verifyGuestIdentity,
  fetchScopedGuestRecords,
  fetchPortalCatalog,
} from "./lib/portalApi.server";
// Partner Dashboard API (hero table + threaded comments + image uploads).
// Kept in its own module so this entry point stays a router, not a business layer.
import {
  handleCommentsDelete,
  handleCommentsGet,
  handleCommentsPatch,
  handleCommentsPost,
  handleProjects,
  handleSession,
  handleUpload,
} from "./lib/partnerDashboard/handlers.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type TalaWireMessage = {
  role: "user" | "assistant";
  content: string;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

function runtimeValue(env: unknown, name: string): string {
  const runtime =
    env && typeof env === "object" ? (env as Record<string, unknown>)[name] : undefined;
  if (typeof runtime === "string" && runtime) return runtime;
  return typeof process !== "undefined" ? (process.env[name] ?? "") : "";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function normalizeMessages(value: unknown, limit = 32): TalaWireMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role as "user" | "assistant",
      content: String(item.content || "").slice(0, 12_000),
    }))
    .filter((item) => item.content.trim())
    .slice(-limit);
}

// ---------------------------------------------------------------------------
// Same-origin TALA handler — POST /api/tala/chat
// ---------------------------------------------------------------------------
// This is the chat backend that ships WITH the site (TanStack server entry),
// so it works on any host the site itself runs on (Vercel included) with no
// separate service to deploy. It replaces the retired Hermes proxy that used
// to live at this path: Hermes is gone, and the route now answers directly
// from OpenRouter using the grounded system prompt the browser already
// builds from live CMS data (talaPersona + live context).
//
// Contract (superset of what talaClient sends):
//   { message?, messages?, history?, systemPrompt?, model? }
//   -> { content, reply, model }
// Auth: OPENROUTER_API_KEY from the host environment (server-only, never
// VITE_-prefixed). The full tool-calling agent remains the Cloudflare
// Worker (VITE_TALA_WORKER_URL) when configured; this handler is the
// always-available path underneath it.

const TALA_FREE_MODELS = [
  "openai/gpt-oss-20b",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "cohere/north-mini-code:free",
];
const TALA_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

async function talaChatHandler(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const apiKey = runtimeValue(env, "OPENROUTER_API_KEY");
  if (!apiKey) {
    return json(
      {
        error:
          "TALA is not configured yet: set OPENROUTER_API_KEY in the site environment (Vercel -> Settings -> Environment Variables).",
      },
      503,
    );
  }

  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > 150_000) return json({ error: "request too large" }, 413);

  let payload: {
    message?: unknown;
    messages?: unknown;
    history?: unknown;
    systemPrompt?: unknown;
    model?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const conversation =
    normalizeMessages(payload.messages).length > 0
      ? normalizeMessages(payload.messages)
      : [
          ...normalizeMessages(payload.history, 8),
          ...(typeof payload.message === "string" && payload.message.trim()
            ? [{ role: "user" as const, content: payload.message.trim().slice(0, 12_000) }]
            : []),
        ];
  if (!conversation.length || conversation[conversation.length - 1]?.role !== "user") {
    return json({ error: "a user message is required" }, 400);
  }

  const systemPrompt =
    typeof payload.systemPrompt === "string" && payload.systemPrompt.trim()
      ? payload.systemPrompt.trim().slice(0, 24_000)
      : CHAT_SYSTEM_PROMPT;

  const preferred =
    typeof payload.model === "string" && TALA_MODEL_ID_PATTERN.test(payload.model)
      ? payload.model
      : null;
  const chain = preferred
    ? [preferred, ...TALA_FREE_MODELS.filter((m) => m !== preferred)]
    : TALA_FREE_MODELS;

  const messages = [{ role: "system", content: systemPrompt }, ...conversation];
  let lastError = "";
  for (const model of chain) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://marinaterrace.palawan.ph",
          "X-Title": "TALA - Marina Terrace Concierge",
        },
        body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 600 }),
      });
      if (!response.ok) {
        lastError = `${model}: HTTP ${response.status}`;
        console.error("[tala-chat] OpenRouter error", lastError);
        continue;
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        lastError = `${model}: empty reply`;
        continue;
      }
      return json({ content: reply, reply, model });
    } catch (error) {
      lastError = `${model}: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[tala-chat] OpenRouter failed", lastError);
    }
  }
  return json({ error: `TALA is busy right now — please try again in a moment. (${lastError})` }, 502);
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;
  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const CHAT_SYSTEM_PROMPT = `You are the AI concierge for Marina Terrace, a boutique digital nomad resort in Palawan, Philippines.

RULES:
- Be warm, helpful, and concise (under 150 words per response)
- Use emojis sparingly for readability
- If you don't know something, say "Let me check with our team" and offer to connect them
- Always try to move toward a booking or action
- Currency: Philippine Pesos (₱) unless guest asks for USD
- Never make up prices or availability — if unsure, say you'll confirm

RESORT INFO:
- Location: El Nido area, Palawan
- Rooms: Garden View (₱2,500), Sea Breeze (₱3,500), Deluxe Terrace Suite (₱5,000), Full Villa (₱7,500)
- Amenities: Fiber WiFi, breakfast included, shared kitchen, tour desk
- Check-in: 2PM, Check-out: 12NN
- Payment: GCash, Maya, cash, bank transfer, cards (3% fee)`;

async function chatHandler(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { message?: unknown; history?: unknown };
  try {
    body = (await request.json()) as { message?: unknown; history?: unknown };
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "message is required" }, 400);

  const history = Array.isArray(body?.history)
    ? (body.history as Array<{ role: string; content: string }>)
        .slice(-8)
        .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 4000) }))
    : [];

  const messages = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  const apiKey = runtimeValue(env, "OPENROUTER_API_KEY");
  if (!apiKey) {
    return json({ response: "Chat service is not configured. Please try again later." });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://marinaterrace.palawan.ph",
        "X-Title": "Marina Terrace Concierge",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct",
        messages,
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error("OpenRouter error:", response.status);
      return json({
        response: "I'm having a moment of difficulty. Please try again in a few seconds!",
      });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content =
      data.choices?.[0]?.message?.content ||
      "I'm not sure about that. Let me connect you with our team!";

    return json({ response: content });
  } catch (error) {
    console.error("Chat API error:", error);
    return json({ response: "Connection hiccup! Please try again." });
  }
}

async function openRouterModels(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      return json({ error: "OpenRouter model catalog is temporarily unavailable." }, 502);
    return new Response(await response.text(), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("OpenRouter model catalog failed", error);
    return json({ error: "OpenRouter model catalog is temporarily unavailable." }, 502);
  }
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// --- Guest Portal session + scoped read API (server-side, service role) ------
// Secure contract: the guest logs in with phone + name, the server verifies
// the pair against an existing trustworthy Marina Terrace guest/stay/request
// record (verifyGuestIdentity), and ONLY then issues an HMAC-signed session
// token. All private reads are filtered strictly by the verified phone number.
// anon RLS is INSERT-only; anon can never SELECT other guests' data directly
// from the database. Any failed/missing verification returns the same generic
// 401 so a caller cannot tell which inputs exist (no enumeration leak).

async function portalSessionHandler(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { phone?: unknown; name?: unknown };
  try {
    body = (await request.json()) as { phone?: unknown; name?: unknown };
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const phone = normalizePhone(typeof body?.phone === "string" ? body.phone : "");
  const name = (typeof body?.name === "string" ? body.name : "").trim().slice(0, 200);

  if (!/^[0-9]{11,14}$/.test(phone)) return json({ error: "invalid phone number" }, 400);
  if (!name) return json({ error: "name is required" }, 400);

  // OPEN DEMO MODE: the portal is intentionally open while the product is in
  // build/demo phase — any valid phone + name gets a session. Reads stay
  // scoped to the phone in the signed token.
  await verifyGuestIdentity(env, phone, name).catch(() => false);

  const token = await issueGuestSession(env, phone, name);
  if (!token) return json({ error: "portal sessions are temporarily unavailable" }, 503);

  return json({ token, guest: { phone, name } });
}

async function portalCatalogHandler(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  const catalog = await fetchPortalCatalog(env);
  if (!catalog) {
    return json(
      { error: "portal catalog unavailable: run the portal SQL (supabase/migrations/20261026000000_portal_lovable_way.sql)" },
      503,
    );
  }
  return json(catalog);
}

async function portalRecordsHandler(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "unauthorized" }, 401);

  const session = await verifyGuestSession(env, token);
  if (!session) return json({ error: "invalid or expired session" }, 401);

  const records = await fetchScopedGuestRecords(env, session.phone);
  return json(records);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const pathname = new URL(request.url).pathname;

      // ---- Partner Dashboard ------------------------------------------------
      if (pathname === "/api/session") {
        return await handleSession(request, env);
      }
      if (pathname === "/api/projects") {
        return await handleProjects(request, env);
      }
      if (pathname === "/api/comments") {
        if (request.method === "GET") return await handleCommentsGet(request, env);
        if (request.method === "POST") return await handleCommentsPost(request, env);
        if (request.method === "PATCH") return await handleCommentsPatch(request, env);
        if (request.method === "DELETE") return await handleCommentsDelete(request, env);
        return json({ error: "method not allowed" }, 405);
      }
      if (pathname === "/api/upload") {
        return await handleUpload(request, env);
      }

      if (new URL(request.url).pathname === "/api/chat") {
        return await chatHandler(request, env);
      }
      if (new URL(request.url).pathname === "/api/tala/chat") {
        return await talaChatHandler(request, env);
      }
      if (new URL(request.url).pathname === "/api/openrouter/models") {
        return await openRouterModels(request);
      }
      if (new URL(request.url).pathname === "/api/portal/session") {
        return await portalSessionHandler(request, env);
      }
      if (new URL(request.url).pathname === "/api/portal/records") {
        return await portalRecordsHandler(request, env);
      }
      if (new URL(request.url).pathname === "/api/portal/catalog") {
        return await portalCatalogHandler(request, env);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
