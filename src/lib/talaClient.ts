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
}

/** Single POST to the Cloudflare TallaAgent. */
export async function talaChat(input: TalaChatInput): Promise<TalaChatResult> {
  const base = talaWorkerBase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.authToken) {
    headers.Authorization = `Bearer ${input.authToken}`;
  } else {
    // No Supabase session (e.g. admin Guest Login). Forward the dev tenant
    // header so the Worker's TALA_DEV_MODE bypass grants owner access in staging.
    headers["X-Dev-Tenant"] = TALA_TENANT;
  }
  const res = await fetch(`${base}/api/talla/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: input.message,
      tenantId: input.tenantId ?? TALA_TENANT,
      role: input.role ?? "guest",
      userId: input.userId,
      model: input.model || undefined,
      guestName: input.guestName,
      guestRoom: input.guestRoom,
    }),
    signal: input.signal,
  });
  const data = (await res.json().catch(() => null)) as
    | { content?: string; error?: string; model?: string; usage?: unknown; timing?: Record<string, number | string> }
    | null;
  if (!res.ok) throw new Error(data?.error || `TALA service error (HTTP ${res.status})`);
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
  const base = talaWorkerBase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (input.authToken) headers.Authorization = `Bearer ${input.authToken}`;
  let res: Response;
  try {
    res = await fetch(`${base}/api/talla/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: input.message,
        tenantId: input.tenantId ?? TALA_TENANT,
        role: input.role ?? "guest",
        userId: input.userId,
        model: input.model || undefined,
        guestName: input.guestName,
        guestRoom: input.guestRoom,
        stream: true,
      }),
      signal: input.signal,
    });
  } catch (e) {
    // A user cancel must stay a cancel; anything else (network/CORS on a Worker
    // deployment that predates streaming) degrades to the buffered call so TALA
    // still answers.
    if ((e as Error)?.name === "AbortError") throw e;
    console.warn("[TALA] streaming unavailable, using buffered reply.", e);
    return talaChat(input);
  }

  const ctype = res.headers.get("Content-Type") || "";
  if (!res.ok || !res.body || !ctype.includes("text/event-stream")) {
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || `TALA service error (HTTP ${res.status})`);
    }
    // Non-SSE response — fall back to the buffered path.
    return talaChat(input);
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