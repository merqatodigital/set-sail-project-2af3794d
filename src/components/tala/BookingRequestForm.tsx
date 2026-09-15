import { useMemo, useRef, useState, useEffect } from "react";
import { Calendar, Loader2, Mail, Phone, Sparkles, User, Users } from "lucide-react";
import type { CmsData } from "@/types/cms";
import { normalizePhone } from "@/lib/portalRepo";
import { todayISO, addDays } from "./talaDate";
import { getGuestSessionId, requestStayBooking } from "./useTalaChat";
import type { TalaIntentPayload } from "./talaIntent";
import { listOffers, type Offer } from "./talaOffers";

const GREEN = "#1F3D2B";
const GOLD = "#C6A15B";
const INK = "#26221C";

const COUNTRY_CODES = ["+63", "+62", "+61", "+65", "+66", "+1", "+44", "+49", "+31", "+33", "+81", "+82", "+86"];

/**
 * Structured stay booking form shown INSIDE the TALA chat whenever a website
 * CTA already told us what the visitor wants (a room, an advertised stay plan,
 * or an all-inclusive package). The selected offer is displayed exactly as it
 * is sold on the site and is never re-asked. Only missing fields are collected.
 * Submit creates exactly ONE pending request through the Cloudflare TallaAgent
 * (same authoritative path as the Day Pass form); nothing is ever presented as
 * confirmed unless the backend returns a reference.
 */
export function BookingRequestForm({
  cms,
  intent,
  offerLabel,
  offerKind,
}: {
  cms: CmsData;
  intent: TalaIntentPayload;
  offerLabel: string;
  offerKind: "room" | "plan" | "package" | "none";
}) {
  const ctx = intent.context ?? {};
  // When the CTA carried no specific selection (e.g. the closing extended-stay
  // button), the visitor picks from the LIVE catalogue instead of typing it out.
  const offers = useMemo(() => listOffers(cms), [cms]);
  const [chosen, setChosen] = useState<Offer | null>(null);
  const effLabel = offerKind === "none" ? chosen?.label ?? "" : offerLabel;
  const effKind: "room" | "plan" | "package" | "none" =
    offerKind === "none" ? chosen?.kind ?? "none" : offerKind;
  const defaultNights = useMemo(
    () => Math.max(1, ctx.nights || chosen?.nights || 1),
    [ctx.nights, chosen],
  );

  const [checkIn, setCheckIn] = useState(ctx.checkIn || todayISO());
  const [checkOut, setCheckOut] = useState(
    ctx.checkOut || addDays(ctx.checkIn || todayISO(), defaultNights),
  );
  const [guests, setGuests] = useState(Math.max(1, ctx.guests || 1));
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+63");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nomad, setNomad] = useState(false);
  const [working, setWorking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [requests, setRequests] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string | null; content: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Picking an offer from the selector re-derives the stay length from its own
  // advertised name (7-Day package -> 7 nights) unless the CTA already knew.
  useEffect(() => {
    if (!chosen || ctx.checkOut) return;
    setCheckOut(addDays(checkIn, Math.max(1, chosen.nights || 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  const tours = useMemo(
    () => (cms.operations?.tours ?? []).filter((t) => t.active !== false).map((t) => t.name),
    [cms],
  );

  const nights = Math.max(
    1,
    Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000) || 1,
  );

  const offerTitle =
    effKind === "package" ? "All-Inclusive Package" : effKind === "plan" ? "Stay Plan" : "Room";

  const canSubmit =
    !busy &&
    !!checkIn &&
    !!checkOut &&
    !!name.trim() &&
    !!email.trim() &&
    !!phone.trim() &&
    (offerKind !== "none" || !!chosen);

  const toggleTour = (t: string) =>
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const submit = async () => {
    if (!canSubmit || busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (normalizePhone(countryCode + phone).length < 8) {
      setError("Please enter a valid WhatsApp/mobile number.");
      return;
    }
    if (new Date(checkOut) <= new Date(checkIn)) {
      setError("Check-out must be after check-in.");
      return;
    }
    setBusy(true);
    setError(null);
    const chatSessionId = getGuestSessionId();
    const idempotencyKey = `stay:${chatSessionId}:${effLabel.toLowerCase()}:${checkIn}:${checkOut}:${name.trim().toLowerCase()}`;
    const timeout = setTimeout(() => console.warn("[BookingForm] timeout", { session: chatSessionId }), 15000);
    try {
      const notes = [
        requests.trim(),
        nomad ? "Digital nomad" : "",
        working ? "Working while staying" : "",
        picked.length ? `Tours of interest: ${picked.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const res = await Promise.race([
        requestStayBooking(
          {
            offerLabel: effLabel,
            offerKind: effKind,
            guestName: name.trim(),
            guestEmail: email.trim(),
            guestPhone: normalizePhone(countryCode + phone),
            checkIn,
            checkOut,
            guests,
            notes,
            idempotencyKey,
            chatSessionId,
          },
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TALA took too long — please tap again.")), 15000)),
      ]);
      if (!res.reference || !res.content) {
        throw new Error(res.content || "TALA couldn't save the request — no reference was returned.");
      }
      if (mounted.current) setDone({ reference: res.reference, content: res.content });
      console.debug("[BookingForm] done", { reference: res.reference, session: chatSessionId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reach TALA.";
      const plain = /timeout|too long/i.test(msg) ? "TALA is busy — please tap Submit again." : /Failed to send/i.test(msg) ? "We couldn't reach the booking service — please try again." : msg;
      if (mounted.current) setError(plain);
      console.warn("[BookingForm] error", { error: msg, session: chatSessionId });
    } finally {
      clearTimeout(timeout);
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div
      className="mx-1 overflow-hidden rounded-xl border-2 px-3.5 py-3"
      style={{ borderColor: GOLD, backgroundColor: "#FFFFFF", color: INK }}
    >
      <p
        className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: GOLD }}
      >
        <Sparkles className="h-3.5 w-3.5" /> {effLabel ? offerTitle : "Book your stay"}
      </p>

      {done ? (
        <div className="py-1">
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">Request saved.</span> Reference{" "}
            <span className="font-mono font-semibold">{done.reference}</span> — the team will confirm
            shortly.
          </p>
          <p className="mt-1.5 text-xs opacity-60">
            Pending until the team confirms. No payment taken now.
          </p>
        </div>
      ) : (
        <>
          {effLabel ? (
            <p className="mt-1 break-words font-serif text-lg leading-snug">{effLabel}</p>
          ) : (
            <p className="mt-1 text-sm leading-relaxed opacity-70">
              Tell us your dates below and TALA will match you with the right room or plan.
            </p>
          )}

          <div className="mt-3 space-y-2.5">
            {offerKind === "none" && offers.length > 0 && (
              <label className="block text-sm">
                <span className="mb-1 flex items-center gap-1 opacity-70">
                  <Sparkles className="h-3.5 w-3.5" /> Room, stay plan or package
                </span>
                <select
                  value={chosen ? `${chosen.kind}:${chosen.label}` : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setChosen(offers.find((o) => `${o.kind}:${o.label}` === v) ?? null);
                  }}
                  className="mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm"
                  style={{ borderColor: `${GOLD}55` }}
                >
                  <option value="">Select…</option>
                  {(["room", "plan", "package"] as const).map((k) => {
                    const group = offers.filter((o) => o.kind === k);
                    if (!group.length) return null;
                    return (
                      <optgroup
                        key={k}
                        label={k === "room" ? "Rooms" : k === "plan" ? "Stay plans" : "All-inclusive packages"}
                      >
                        {group.map((o) => (
                          <option key={`${k}:${o.label}`} value={`${k}:${o.label}`}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </label>
            )}

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Calendar className="h-3.5 w-3.5" /> Check-in
              </span>
              <input
                type="date"
                min={todayISO()}
                value={checkIn}
                onChange={(e) => {
                  const v = e.target.value || todayISO();
                  setCheckIn(v);
                  if (new Date(checkOut) <= new Date(v)) setCheckOut(addDays(v, defaultNights));
                }}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Calendar className="h-3.5 w-3.5" /> Check-out
              </span>
              <input
                type="date"
                min={addDays(checkIn, 1)}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value || addDays(checkIn, defaultNights))}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
              <span className="mt-1 block text-[11px] opacity-60">
                {nights} night{nights > 1 ? "s" : ""}
              </span>
            </label>

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Users className="h-3.5 w-3.5" /> Guests
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={guests}
                onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <User className="h-3.5 w-3.5" /> Full name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Phone className="h-3.5 w-3.5" /> WhatsApp / mobile
              </span>
              <span className="mt-1 flex gap-1.5">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-20 shrink-0 rounded-md border px-1.5 py-1.5 text-sm"
                  style={{ borderColor: `${GOLD}55` }}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9XX XXX XXXX"
                  className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
                  style={{ borderColor: `${GOLD}55` }}
                />
              </span>
            </label>

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Mail className="h-3.5 w-3.5" /> Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNomad((v) => !v)}
                className="flex-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                style={
                  nomad
                    ? { backgroundColor: GREEN, color: "#fff" }
                    : { border: `1px solid ${GOLD}55`, color: INK }
                }
              >
                Digital nomad
              </button>
              <button
                type="button"
                onClick={() => setWorking((v) => !v)}
                className="flex-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                style={
                  working
                    ? { backgroundColor: GREEN, color: "#fff" }
                    : { border: `1px solid ${GOLD}55`, color: INK }
                }
              >
                Working here
              </button>
            </div>

            {tours.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] opacity-70">Tours you might like (optional)</p>
                <div className="flex flex-wrap gap-1.5">
                  {tours.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTour(t)}
                      className="max-w-full truncate rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                      style={
                        picked.includes(t)
                          ? { backgroundColor: GOLD, color: "#fff" }
                          : { border: `1px solid ${GOLD}55`, color: INK }
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="block text-sm">
              <span className="opacity-70">Anything else? (optional)</span>
              <textarea
                value={requests}
                onChange={(e) => setRequests(e.target.value)}
                rows={2}
                placeholder="Arrival time, dietary needs, requests…"
                className="mt-1 w-full resize-none rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>
          </div>

          {error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <p className="mt-2 text-[11px] opacity-60">
            Pending — the team confirms after you submit. No payment now.
          </p>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-2 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: GREEN }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "Sending to TALA…" : "Submit booking request"}
          </button>
        </>
      )}
    </div>
  );
}