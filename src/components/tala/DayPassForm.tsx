import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Clock,
  Loader2,
  Mail,
  Minus,
  Phone,
  Plus,
  Sparkles,
  User,
  Users,
  Utensils,
} from "lucide-react";
import type { CmsData, MenuCategory } from "@/types/cms";
import { useCurrency } from "@/context/CurrencyContext";
import { normalizePhone, createFoodOrder } from "@/lib/portalRepo";
import { todayISO } from "./talaDate";
import { getGuestSessionId, requestDayPass } from "./useTalaChat";

const GREEN = "#1F3D2B";
const GREEN_DARK = "#16301F";
const GOLD = "#C6A15B";
const CREAM = "#FAF6EF";
const INK = "#26221C";

const COUNTRY_CODES = ["+63", "+62", "+61", "+65", "+66", "+1", "+44", "+49", "+31", "+33", "+81", "+82", "+86"];

const SERVING_TIMES = ["On my arrival", "7–9 AM", "12–2 PM", "6–9 PM", "Anytime"];

const CATEGORIES: { key: MenuCategory; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "drinks", label: "Drinks" },
];

interface CartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  price: number;
  foodCost: number;
}

/**
 * Workspace Day Pass structured form.
 *
 * The guest picks a day, how many people, contact details, arrival time and
 * any allergies/requests — plus an optional FOOD ADD-ON built from the live
 * menu (prices authoritative from cms_data; never invented client-side).
 * Confirm POSTs the Day Pass through the SAME Cloudflare TallaAgent that
 * powers TALA chat (requestRoomBooking → one pending tala_booking_requests
 * row, MT- ref, guests + notes persisted). The food add-on persists to
 * tala_food_orders (same Supabase source the Guest Portal folio reads) so the
 * day pass and its food land in one guest bill. No fake payment ever.
 */
export function DayPassForm({ cms }: { cms: CmsData }) {
  const { formatPrice } = useCurrency();

  // Authoritative day pass price (PHP/day): settings.financial.dayPassPrice,
  // falling back to the parsed "Day Pass" cms.pricing row, then 1040.
  const pricePerDay = useMemo(() => {
    const configured = cms.settings?.financial?.dayPassPrice;
    if (typeof configured === "number" && configured > 0) return configured;
    const row = [...(cms.pricing ?? [])]
      .sort((a, b) => a.order - b.order)
      .find((p) => /day ?pass/i.test(p.name));
    const parsed = row ? Number(String(row.price).replace(/[^\d.]/g, "")) : 0;
    return parsed > 0 ? parsed : 1040;
  }, [cms]);

  const [day, setDay] = useState(todayISO());
  const [people, setPeople] = useState(1);
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+63");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [arrival, setArrival] = useState("");
  const [allergies, setAllergies] = useState("");
  const [requests, setRequests] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    reference: string | null;
    foodReference: string | null;
    foodStatus: "none" | "saved" | "failed";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  // Food add-on
  const [showFood, setShowFood] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tab, setTab] = useState<MenuCategory>("breakfast");
  const [servingTime, setServingTime] = useState(SERVING_TIMES[0]);
  const [foodNotes, setFoodNotes] = useState("");

  const menuItems = useMemo(
    () => (cms.operations?.menuItems ?? []).filter((m) => m.active).sort((a, b) => a.order - b.order),
    [cms],
  );
  const filteredItems = useMemo(() => menuItems.filter((m) => m.category === tab), [menuItems, tab]);

  const addToCart = (item: { id: string; name: string; price: number; foodCost: number }) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) return prev.map((c) => (c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { menuItemId: item.id, name: item.name, quantity: 1, price: item.price, foodCost: item.foodCost }];
    });
  };

  const updateQty = (menuItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.menuItemId === menuItemId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0),
    );
  };

  const foodTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const foodCostTotal = cart.reduce((s, c) => s + c.foodCost * c.quantity, 0);
  const dayPassSubtotal = pricePerDay * people;
  const grandTotal = dayPassSubtotal + foodTotal;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const canSubmit = !busy && !!day && people >= 1 && !!name.trim() && !!email.trim() && !!phone.trim();

  const submit = async () => {
    if (!canSubmit || busy) return;
    // Client-side field validation — never silent hang
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (normalizePhone(countryCode + phone).length < 8) {
      setError("Please enter a valid WhatsApp/mobile number.");
      return;
    }
    setBusy(true);
    setError(null);
    // Idempotency: same guest + day + session → same key, prevents double bookings on double-click/retry
    const chatSessionId = getGuestSessionId();
    const idempotencyKey = `daypass:${chatSessionId}:${day}:${name.trim().toLowerCase()}:${normalizePhone(countryCode + phone)}`;
    // Timeout guard — spinner must stop even if network hangs (15s)
    const timeout = setTimeout(() => {
      if (mounted.current && busy) {
        // Will be cleared by catch/finally, but ensure we log
        console.warn("[DayPassForm] timeout waiting for TALA");
      }
    }, 15000);
    try {
      const fullPhone = normalizePhone(countryCode + phone);
      const notesParts: string[] = [];
      if (arrival) notesParts.push(`Arrival around ${arrival}`);
      if (allergies.trim()) notesParts.push(`Allergies/dietary: ${allergies.trim()}`);
      if (requests.trim()) notesParts.push(requests.trim());
      const notes = notesParts.join(" · ");

      // Day Pass through the unified pipeline — returns BEFORE WhatsApp/email (fire-and-forget)
      const res = await Promise.race([
        requestDayPass({
          guestName: name.trim(),
          guestEmail: email.trim(),
          guestPhone: fullPhone,
          day,
          guests: people,
          notes,
          idempotencyKey,
          chatSessionId,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TALA took too long — please tap again.")), 15000)),
      ]);

      // Only a returned MT- reference means tala_booking_requests actually
      // got a row. If TALA asked for more details or failed to book, never
      // claim the request was saved — surface the agent's reply instead, and
      // skip the food write (no orphan food order without a day pass).
      if (!res.reference || !res.content) {
        throw new Error(
          res.content || "TALA couldn't save the request — no confirmation reference was returned.",
        );
      }

      // Food add-on persists to tala_food_orders (the Supabase source the
      // Guest Portal folio reads) so the pass + food show up on one bill.
      // Success and failure are BOTH surfaced to the guest — a failed food
      // order is never implied to have succeeded.
      let foodStatus: "none" | "saved" | "failed" = cart.length ? "failed" : "none";
      let foodReference: string | null = null;
      if (cart.length) {
        const foodIdem = `food:${idempotencyKey}`;
        const saved = await createFoodOrder({
          guest: { name: name.trim(), phone: fullPhone },
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            name: c.name,
            quantity: c.quantity,
            price: c.price,
            foodCost: c.foodCost,
          })),
          total: foodTotal,
          totalCost: foodCostTotal,
          notes: `Serving: ${servingTime}.${foodNotes.trim() ? " " + foodNotes.trim() : ""}`,
          idempotencyKey: foodIdem,
          chatSessionId,
        });
        if (saved) {
          foodStatus = "saved";
          foodReference = saved.reference;
        } else {
          foodStatus = "failed";
        }
      }

      if (mounted.current) setDone({ reference: res.reference, foodReference, foodStatus });
      console.debug("[DayPassForm] done", { reference: res.reference, session: chatSessionId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reach TALA.";
      // Plain language mapping
      const plain = /timeout|too long/i.test(msg) ? "TALA is busy — please tap Request Day Pass again." : /Failed to send/i.test(msg) ? "We couldn't reach the booking service — please try again." : msg;
      if (mounted.current) setError(plain);
      console.warn("[DayPassForm] error", { error: msg, session: chatSessionId });
    } finally {
      clearTimeout(timeout);
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div
      className="mx-1 rounded-xl border-2 px-3.5 py-3"
      style={{ borderColor: GOLD, backgroundColor: "#FFFFFF", color: INK }}
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: GOLD }}>
        <Sparkles className="h-3.5 w-3.5" /> Workspace Day Pass
      </p>

      {done ? (
        <div className="py-1">
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">Request saved.</span>{" "}
            {done.reference ? (
              <>Reference <span className="font-mono font-semibold">{done.reference}</span> — the team will confirm shortly.</>
            ) : (
              "The team will confirm shortly."
            )}
          </p>
          {done.foodReference && done.foodStatus === "saved" && (
            <p className="mt-1.5 text-sm leading-relaxed">
              Food order <span className="font-mono font-semibold">{done.foodReference}</span> placed for your day. We'll have it ready at serving time.
            </p>
          )}
          {done.foodStatus === "failed" && (
            <p className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Your food order was NOT saved — nothing has been added to your bill. Please order again, or message Reception to add it.
            </p>
          )}
          <p className="mt-1.5 text-xs opacity-60">
            No payment taken now. You'll settle once the day pass is confirmed.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-sm opacity-70">
              Day Pass<span className="ml-1 text-xs opacity-50">/ day</span>
            </span>
            <span className="font-serif text-xl">{formatPrice(pricePerDay)}</span>
          </div>

          <div className="mt-3 space-y-2.5">
            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Calendar className="h-3.5 w-3.5" /> Day
              </span>
              <input
                type="date"
                min={todayISO()}
                value={day}
                onChange={(e) => setDay(e.target.value || todayISO())}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Users className="h-3.5 w-3.5" /> People
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={people}
                onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
              <span className="mt-1 block text-[11px] opacity-60">
                {people} × {formatPrice(pricePerDay)} = {formatPrice(dayPassSubtotal)}
              </span>
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
                  className="rounded-md border px-1.5 py-1.5 text-sm"
                  style={{ borderColor: `${GOLD}55` }}
                  aria-label="Country code"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9XX XXX XXXX"
                  className="flex-1 rounded-md border px-2 py-1.5 text-sm"
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

            <label className="block text-sm">
              <span className="mb-1 flex items-center gap-1 opacity-70">
                <Clock className="h-3.5 w-3.5" /> Arrival time
              </span>
              <input
                type="time"
                value={arrival}
                onChange={(e) => setArrival(e.target.value)}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 opacity-70">Allergies / dietary needs</span>
              <input
                type="text"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="Vegetarian, peanut allergy, halal…"
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 opacity-70">Special requests</span>
              <textarea
                value={requests}
                onChange={(e) => setRequests(e.target.value)}
                placeholder="Anything else we should know"
                rows={2}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: `${GOLD}55` }}
              />
            </label>
          </div>

          {/* Food add-on */}
          <div className="mt-3 rounded-lg border" style={{ borderColor: `${GOLD}55` }}>
            <button
              type="button"
              onClick={() => setShowFood((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold"
              style={{ color: INK }}
            >
              <span className="flex items-center gap-1.5">
                <Utensils className="h-3.5 w-3.5" style={{ color: GOLD }} /> Food & drinks for your day
              </span>
              <span className="text-[11px] opacity-60">{showFood ? "Hide" : "Add"}</span>
            </button>

            {showFood && (
              <div className="space-y-2.5 border-t px-3 py-2.5" style={{ borderColor: `${GOLD}33` }}>
                <div className="flex gap-1.5">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setTab(c.key)}
                      className="flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors"
                      style={
                        tab === c.key
                          ? { backgroundColor: GREEN, color: "#fff" }
                          : { border: `1px solid ${GOLD}55`, color: INK }
                      }
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                <div className="max-h-44 space-y-1 overflow-y-auto pr-0.5">
                  {filteredItems.map((item) => {
                    if (item.inventoryCount <= 0) return null;
                    const inCart = cart.find((c) => c.menuItemId === item.id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs"
                        style={{ backgroundColor: `${GOLD}0D` }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{item.name}</span>
                          <span className="ml-1.5 opacity-60" style={{ color: GOLD }}>
                            {formatPrice(item.price)}
                          </span>
                        </span>
                        {inCart ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, -1)}
                              className="flex h-5 w-5 items-center justify-center rounded-full"
                              style={{ backgroundColor: `${GOLD}22`, color: GOLD }}
                              aria-label={`Remove one ${item.name}`}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-4 text-center">{inCart.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQty(item.id, 1)}
                              disabled={inCart.quantity >= item.inventoryCount}
                              className="flex h-5 w-5 items-center justify-center rounded-full disabled:opacity-30"
                              style={{ backgroundColor: `${GOLD}22`, color: GOLD }}
                              aria-label={`Add one ${item.name}`}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addToCart(item)}
                            className="flex h-5 w-5 items-center justify-center rounded-full"
                            style={{ backgroundColor: GREEN, color: "#fff" }}
                            aria-label={`Add ${item.name}`}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {filteredItems.every((i) => i.inventoryCount <= 0) && (
                    <p className="py-2 text-center text-[11px] opacity-50">Nothing available in this category right now.</p>
                  )}
                </div>

                <label className="block text-xs">
                  <span className="mb-1 opacity-70">Serving time</span>
                  <select
                    value={servingTime}
                    onChange={(e) => setServingTime(e.target.value)}
                    className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                    style={{ borderColor: `${GOLD}55` }}
                  >
                    {SERVING_TIMES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs">
                  <span className="mb-1 opacity-70">Food notes / allergies</span>
                  <textarea
                    value={foodNotes}
                    onChange={(e) => setFoodNotes(e.target.value)}
                    placeholder="e.g. extra rice, no ice…"
                    rows={1}
                    className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                    style={{ borderColor: `${GOLD}55` }}
                  />
                </label>

                <div className="flex items-center justify-between text-xs">
                  <span className="opacity-70">Food total</span>
                  <span className="font-semibold" style={{ color: GOLD }}>{formatPrice(foodTotal)}</span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <p className="mt-2 text-[11px] opacity-60">
            No payment taken now — this saves a request and the team confirms before you settle.
          </p>

          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="opacity-70">Estimated total</span>
            <span className="font-serif text-lg font-semibold" style={{ color: GREEN }}>
              {formatPrice(grandTotal)}
            </span>
          </div>
          {grandTotal !== dayPassSubtotal && (
            <p className="text-[10px] opacity-50">{formatPrice(dayPassSubtotal)} day pass + {formatPrice(foodTotal)} food</p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: GREEN }}
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking TALA…
              </>
            ) : (
              "Request Day Pass"
            )}
          </button>
        </>
      )}
    </div>
  );
}