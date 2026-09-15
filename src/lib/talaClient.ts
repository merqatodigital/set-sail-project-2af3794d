// ---------------------------------------------------------------------------
// talaClient.ts — THE single place the browser talks to the Cloudflare
// TallaAgent Worker. Text chat, voice transcripts, CTA intents, Day Pass and
// owner Ask TALA all go through here:
//
//   browser -> ${VITE_TALA_WORKER_URL}/api/talla/chat -> TallaAgent DO -> tools
//
// Rules:
//  - ONE env var: VITE_TALA_WORKER_URL (legacy VITE_TALLA_WORKER_URL /
//    VITE_WORKER_URL are still read for backwards compatibility only).
//  - NO hardcoded worker fallback, NO fallback to the site's own origin.
//    A missing config throws a clear error instead of hitting the wrong host.
//  - role is CONTEXT ONLY. Owner privileges are granted by the Worker after it
//    verifies the forwarded Supabase access token — never by this field.
// ---------------------------------------------------------------------------

export const TALA_TENANT = "marina_terrace";

const MISSING =
  "TALA is not configured: VITE_TALA_WORKER_URL is missing. Set it to the deployed Cloudflare Worker URL.";

/** Resolve the Cloudflare Worker base URL. Throws when unconfigured. */
export function talaWorkerBase(): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const raw =
    env.VITE_TALA_WORKER_URL ||
    // deprecated names, kept only so an already-configured deploy keeps working
    env.VITE_TALLA_WORKER_URL ||
    env.VITE_WORKER_URL ||
    "";
  const base = raw.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) throw new Error(MISSING);
  return base;
}

/** Non-throwing variant for status/diagnostic surfaces. */
export function talaWorkerBaseOrNull(): string | null {
  try {
    return talaWorkerBase();
  } catch {
    return null;
  }
}

export interface TalaChatResult {
  content: string | null;
  model?: string;
  usage?: unknown;
  /** Worker-side latency breakdown (promptMs / llmMs / toolMs / totalMs …). */
  timing?: Record<string, number | string>;
}

export interface TalaChatInput {
  message: string;
  /** Current CMS + knowledge-base instructions used by the backend fallback. */
  systemPrompt?: string;
  /** Context hint only — the Worker authorizes owners via the bearer token. */
  role?: "guest" | "owner";
  /** Stable session id so the Durable Object remembers this conversation. */
  userId: string;
  tenantId?: string;
  model?: string;
  /** Supabase access token, forwarded for owner/admin authorization. */
  authToken?: string;
  guestName?: string;
  guestRoom?: string;
  signal?: AbortSignal;
  /** Idempotency key per chat session + form — prevents duplicate bookings on retry/double-click. */
  idempotencyKey?: string;
  /** Chat/session/thread ID attached to every record for backoffice correlation. */
  chatSessionId?: string;
}

async function talaBackendFallback(input: TalaChatInput): Promise<TalaChatResult> {
  const { supabase } = await import("@/integrations/supabase/client");
  const messages = [
    input.systemPrompt ? { role: "system", content: input.systemPrompt } : null,
    { role: "user", content: input.message },
  ].filter((message): message is { role: string; content: string } => message !== null);
  // Structured log: fallback start
  console.debug("[tala] fallback", { session: input.chatSessionId ?? input.userId, idem: input.idempotencyKey ?? "none" });
  const { data, error } = await supabase.functions.invoke("tala-chat", {
    body: {
      messages,
      model: input.model || undefined,
      idempotencyKey: input.idempotencyKey,
      chatSessionId: input.chatSessionId ?? input.userId,
    },
  });
  if (error) {
    // Map known edge errors to plain language
    const msg = error.message || "TALA backend is unavailable.";
    if (/non-2xx/i.test(msg)) throw new Error("TALA had a hiccup — please try again in a moment.");
    throw new Error(msg);
  }
  const result = data as { reply?: string; content?: string; error?: string } | null;
  if (result?.error) {
    // Surface validation errors verbatim; map auth/config to plain language
    if (/not configured/i.test(result.error)) throw new Error("TALA is warming up — please try again shortly.");
    throw new Error(result.error);
  }
  return { content: result?.reply ?? result?.content ?? null };
}

/** Single POST to the Cloudflare TallaAgent. Returns BEFORE WhatsApp/email. */
export async function talaChat(input: TalaChatInput): Promise<TalaChatResult> {
  let base: string;
  try {
    base = talaWorkerBase();
  } catch {
    return talaBackendFallback(input);
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.authToken) {
    headers.Authorization = `Bearer ${input.authToken}`;
  } else {
    headers["X-Dev-Tenant"] = TALA_TENANT;
  }
  // Always enforce a timeout — prevents infinite spinner. Default 15s, caller can override via signal.
  const timeoutSignal = input.signal ?? AbortSignal.timeout(15000);
  // Log start
  console.debug("[tala] chat start", { base, session: input.chatSessionId ?? input.userId, idem: input.idempotencyKey ?? "none" });
  let res: Response;
  try {
    res = await fetch(`${base}/api/talla/chat`, {
      method: "POST",
      headers: {
        ...headers,
        ...(input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : {}),
        ...(input.chatSessionId ? { "X-Chat-Session-Id": input.chatSessionId } : {}),
      },
      body: JSON.stringify({
        message: input.message,
        tenantId: input.tenantId ?? TALA_TENANT,
        role: input.role ?? "guest",
        userId: input.userId,
        model: input.model || undefined,
        guestName: input.guestName,
        guestRoom: input.guestRoom,
        idempotencyKey: input.idempotencyKey,
        chatSessionId: input.chatSessionId ?? input.userId,
      }),
      signal: timeoutSignal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      console.warn("[tala] chat aborted/timeout", { session: input.chatSessionId ?? input.userId });
      throw new Error("TALA took too long — please try again.");
    }
    console.warn("[tala] chat fetch failed, fallback", { err: (error as Error).message });
    return talaBackendFallback(input);
  }
  const data = (await res.json().catch(() => null)) as
    | { content?: string; error?: string; model?: string; usage?: unknown; timing?: Record<string, number | string> }
    | null;
  if (!res.ok) {
    if (res.status >= 500) {
      console.warn("[tala] worker 500, fallback", { status: res.status });
      return talaBackendFallback(input);
    }
    // 4xx validation — surface as field-level error in chat
    const plain = data?.error || `Please check your details (HTTP ${res.status}).`;
    throw new Error(plain);
  }
  console.debug("[tala] chat ok", { session: input.chatSessionId ?? input.userId });
  return { content: data?.content ?? null, model: data?.model, usage: data?.usage, timing: data?.timing };
}

/**
 * Streaming variant — consumes the Worker's existing SSE endpoint so text
 * appears as TALA generates it instead of after the whole reply is buffered.
 * The Worker emits `data: {type:"text"|"done"|"aborted"|"error", …}` frames.
 * Falls back to the buffered JSON call when the response isn't SSE (older
 * Worker deployments), so behaviour never regresses.
 */
export async function talaChatStream(
  input: TalaChatInput,
  onDelta: (text: string) => void,
): Promise<TalaChatResult> {
  let base: string;
  try {
    base = talaWorkerBase();
  } catch {
    const res = await talaBackendFallback(input);
    if (res.content) onDelta(res.content);
    return res;
  }
  // Timeout for streaming: 20s total
  const timeoutSignal = input.signal ?? AbortSignal.timeout(20000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (input.authToken) headers.Authorization = `Bearer ${input.authToken}`;
  let res: Response;
  try {
    res = await fetch(`${base}/api/talla/chat`, {
      method: "POST",
      headers: {
        ...headers,
        ...(input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : {}),
        ...(input.chatSessionId ? { "X-Chat-Session-Id": input.chatSessionId } : {}),
      },
      body: JSON.stringify({
        message: input.message,
        tenantId: input.tenantId ?? TALA_TENANT,
        role: input.role ?? "guest",
        userId: input.userId,
        model: input.model || undefined,
        guestName: input.guestName,
        guestRoom: input.guestRoom,
        stream: true,
        idempotencyKey: input.idempotencyKey,
        chatSessionId: input.chatSessionId ?? input.userId,
      }),
      signal: timeoutSignal,
    });
  } catch (e) {
    // A user cancel must stay a cancel; anything else (network/CORS on a Worker
    // deployment that predates streaming) degrades to the buffered call so TALA
    // still answers.
    if ((e as Error)?.name === "AbortError") throw e;
    console.warn("[TALA] streaming unavailable, using backend fallback.");
    return talaBackendFallback(input);
  }

  const ctype = res.headers.get("Content-Type") || "";
  if (!res.ok || !res.body || !ctype.includes("text/event-stream")) {
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || `TALA service error (HTTP ${res.status})`);
    }
    // Non-SSE response — use the independent backend path rather than retrying
    // the same Worker host that just failed.
    return talaBackendFallback(input);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";
  let result: TalaChatResult = { content: null };

  const handleFrame = (raw: string) => {
    const line = raw.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (evt.type === "text" && typeof evt.text === "string") {
      acc += evt.text;
      onDelta(evt.text);
    } else if (evt.type === "done") {
      result = {
        content: (typeof evt.content === "string" && evt.content) || acc || null,
        model: typeof evt.model === "string" ? evt.model : undefined,
        usage: evt.usage ?? undefined,
        timing: (evt.timing as Record<string, number | string>) ?? undefined,
      };
    } else if (evt.type === "error") {
      throw new Error(typeof evt.error === "string" ? evt.error : "TALA stream failed.");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handleFrame(frame);
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  if (!result.content && acc) result = { ...result, content: acc };
  return result;
}

/** Current Supabase access token, or "" when nobody is signed in. */
export async function talaOwnerToken(): Promise<string> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  } catch {
    return "";
  }
}

/** Signed-in user id (stable owner session key), or null. */
export async function talaOwnerUserId(): Promise<string | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}