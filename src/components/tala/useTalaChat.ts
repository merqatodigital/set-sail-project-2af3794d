import { useCallback, useRef, useState } from "react";
import { TALA_STORAGE, type TalaMessage } from "./talaConfig";
import { captureGuestLead, confirmBookingDraft } from "./talaTools";
import { classifyHeuristically, writeAuditEntry, type TalaClassification } from "./talaGraph";
import { detectSentiment } from "./talaSentiment";
import { useCms } from "@/context/CmsContext";
import type { CmsData } from "@/types/cms";
import { talaChat, talaChatStream, talaOwnerToken, talaOwnerUserId } from "@/lib/talaClient";

interface AssistantReply {
  content: string | null;
  timing?: Record<string, number | string>;
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDevApiKey(): string {
  try { return localStorage.getItem(TALA_STORAGE.devApiKey) ?? ""; } catch { return ""; }
}

export function setDevApiKey(key: string) {
  try {
    if (key) localStorage.setItem(TALA_STORAGE.devApiKey, key);
    else localStorage.removeItem(TALA_STORAGE.devApiKey);
  } catch {}
}

export function getGuestSessionId(): string {
  try {
    const KEY = "tala.guestSessionId";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `guest-anon-${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function askCloudflareAgent(
  text: string,
  opts?: {
    model?: string;
    owner?: boolean;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
    systemPrompt?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  },
): Promise<AssistantReply> {
  if (!text.trim()) throw new Error("Empty message.");
  let authToken: string | undefined;
  let userId = getGuestSessionId();
  if (opts?.owner) {
    const [token, ownerId] = await Promise.all([talaOwnerToken(), talaOwnerUserId()]);
    authToken = token || undefined;
    if (ownerId) userId = ownerId;
  }
  const payload = {
    message: text,
    role: (opts?.owner ? "owner" : "guest") as "owner" | "guest",
    userId,
    model: opts?.model,
    authToken,
    signal: opts?.signal,
    systemPrompt: opts?.systemPrompt,
    history: opts?.history,
  };
  const result = opts?.onDelta ? await talaChatStream(payload, opts.onDelta) : await talaChat(payload);
  const content = result.content?.trim() || "";
  if (!content) throw new Error("TALA returned an empty reply.");
  return { content, timing: result.timing };
}


export interface RequestDayPassInput {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  day: string;
  guests?: number;
  notes?: string;
}

export async function requestDayPass(input: RequestDayPassInput, preferredModel?: string): Promise<{ content: string; reference: string | null }> {
  const day = input.day.slice(0, 10);
  const { addDays } = await import("./talaDate");
  const next = addDays(day, 1);
  const guests = Math.max(1, Math.floor(input.guests ?? 1));
  const notes = (input.notes || "").trim();
  const text = [
    `I'd like to book a Workspace Day Pass on ${day} for ${guests} guest${guests > 1 ? "s" : ""}.`,
    `My name is ${input.guestName}.`,
    `My email is ${input.guestEmail}.`,
    `My WhatsApp/mobile number is ${input.guestPhone}.`,
    `Check-in ${day}, check-out ${next} (single day pass).`,
    notes ? `Additional requests: ${notes}.` : "",
  ].filter(Boolean).join(" ");
  const reply = await askCloudflareAgent(text, { model: preferredModel });
  const match = reply.content?.match(/\bMT-\d{8}-\d{4}\b/);
  return { content: reply.content || "", reference: match ? match[0] : null };
}

export interface RequestStayBookingInput {
  offerLabel: string;
  offerKind: "room" | "plan" | "package" | "none";
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  notes?: string;
}

export async function requestStayBooking(input: RequestStayBookingInput, preferredModel?: string): Promise<{ content: string; reference: string | null }> {
  const label = input.offerLabel.trim();
  const kindWord = input.offerKind === "package" ? "all-inclusive package" : input.offerKind === "plan" ? "stay plan" : "room";
  const guests = Math.max(1, Math.floor(input.guests || 1));
  const notes = (input.notes || "").trim();
  const text = [
    label ? `I'd like to book the ${label} ${kindWord} currently advertised on the Marina Terrace website. Use "${label}" as the roomType/plan for this booking request.` : `I'd like to book a stay at Marina Terrace.`,
    `Check-in ${input.checkIn}, check-out ${input.checkOut}, ${guests} guest${guests > 1 ? "s" : ""}.`,
    `My name is ${input.guestName}.`,
    `My email is ${input.guestEmail}.`,
    `My WhatsApp/mobile number is ${input.guestPhone}.`,
    notes ? `Additional requests: ${notes}.` : "",
    `Please create the pending booking request now — do not ask me to repeat any of these details.`,
  ].filter(Boolean).join(" ");
  const reply = await askCloudflareAgent(text, { model: preferredModel });
  const match = reply.content?.match(/\bMT-\d{8}-\d{4}\b/);
  return { content: reply.content || "", reference: match ? match[0] : null };
}

export interface TalaRunInfo {
  classification: TalaClassification;
  toolsUsed: string[];
}

interface BookingDraft {
  id: string;
  reference: string;
  guestName: string;
  guestPhone: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  amount: number;
  notes: string;
}

export interface UseTalaChat {
  messages: TalaMessage[];
  thinking: boolean;
  error: string | null;
  pendingDraft: BookingDraft | null;
  lastRun: TalaRunInfo | null;
  lastTurn: { ms: number; text: string } | null;
  send: (
    text: string,
    systemPrompt: string,
    options?: {
      model?: string;
      adminApiKey?: string;
      cms?: CmsData;
      owner?: boolean;
      onDelta?: (delta: string) => void;
    },
  ) => Promise<string | null>;
  confirmDraft: (extra?: { email?: string; phone?: string; nomad?: boolean; working?: boolean; tours?: string[] }) => void;
  clearDraft: () => void;
  reset: () => void;
}

export function useTalaChat(): UseTalaChat {
  const [messages, setMessages] = useState<TalaMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<TalaRunInfo | null>(null);
  const [pendingDraft, setPendingDraft] = useState<BookingDraft | null>(null);
  const [lastTurn, setLastTurn] = useState<{ ms: number; text: string } | null>(null);
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const { update: persistCms } = useCms();
  const messagesRef = useRef<TalaMessage[]>([]);

  const send = useCallback(async (
    text: string,
    _systemPrompt: string,
    options?: { model?: string; adminApiKey?: string; cms?: CmsData; owner?: boolean; onDelta?: (delta: string) => void },
  ): Promise<string | null> => {
    const trimmed = text.trim();
    if (!trimmed || inFlight.current) return null;
    inFlight.current = true;
    setError(null);
    setThinking(true);
    const turnStart = performance.now();

    const userMsg: TalaMessage = { id: newId(), role: "user", content: trimmed };
    const history: TalaMessage[] = [...messagesRef.current, userMsg];
    messagesRef.current = history;
    setMessages(history);

    if (!options?.owner) void captureGuestLead(trimmed, options?.cms?.settings?.siteName || "guest");
    const sentiment = detectSentiment(trimmed);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const assistantId = newId();
      let streamed = "";
      let firstTokenMs: number | null = null;
      const reply = await askCloudflareAgent(trimmed, {
        model: options?.model,
        owner: options?.owner,
        signal: controller.signal,
        onDelta: (delta) => {
          if (firstTokenMs === null) {
            firstTokenMs = Math.round(performance.now() - turnStart);
            setThinking(false);
            messagesRef.current = [...messagesRef.current, { id: assistantId, role: "assistant", content: "" }];
          }
          streamed += delta;
          messagesRef.current = messagesRef.current.map((m) => m.id === assistantId ? { ...m, content: streamed } : m);
          setMessages(messagesRef.current);
          options?.onDelta?.(delta);
        },
      });

      const finalText = reply.content?.trim();
      if (!finalText) throw new Error("TALA didn't have a reply.");
      const hasPlaceholder = messagesRef.current.some((m) => m.id === assistantId);
      messagesRef.current = hasPlaceholder
        ? messagesRef.current.map((m) => m.id === assistantId ? { ...m, content: finalText } : m)
        : [...messagesRef.current, { id: newId(), role: "assistant", content: finalText }];
      setMessages(messagesRef.current);

      const classification = classifyHeuristically(trimmed);
      setLastRun({ classification, toolsUsed: [] });
      writeAuditEntry({ classification, guestMessage: trimmed, replyPreview: finalText, toolsUsed: [], sentiment: sentiment.sentiment });
      const turnMs = Math.round(performance.now() - turnStart);
      console.debug(`[TALA] first token ${firstTokenMs ?? "n/a"}ms · complete ${turnMs}ms`, reply.timing ?? "");
      setLastTurn({ ms: turnMs, text: finalText.slice(0, 80) });
      return finalText;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setError(msg);
      return null;
    } finally {
      inFlight.current = false;
      setThinking(false);
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    messagesRef.current = [];
    setMessages([]);
    setError(null);
    setLastRun(null);
    setLastTurn(null);
    setPendingDraft(null);
  }, []);

  const clearDraft = useCallback(() => setPendingDraft(null), []);

  const confirmDraft = useCallback((extra?: { email?: string; phone?: string; nomad?: boolean; working?: boolean; tours?: string[] }) => {
    if (!pendingDraft) return;
    const notes = [
      pendingDraft.notes,
      extra?.email ? `Email: ${extra.email}` : "",
      extra?.phone ? `Phone: ${extra.phone}` : "",
      extra?.nomad ? "Digital nomad" : "",
      extra?.working ? "Working while staying" : "",
      extra?.tours?.length ? `Tours of interest: ${extra.tours.join(", ")}` : "",
    ].filter(Boolean).join(" · ");
    confirmBookingDraft({ ...pendingDraft, notes, guestPhone: extra?.phone || pendingDraft.guestPhone }, persistCms);
    setPendingDraft(null);
  }, [pendingDraft, persistCms]);

  return { messages, thinking, error, lastRun, lastTurn, send, reset, clearDraft, pendingDraft, confirmDraft };
}
