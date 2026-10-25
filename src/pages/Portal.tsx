import { useState, useCallback, useEffect } from "react";
import { useCms } from "@/context/CmsContext";
import type { Motorbike, Tour } from "@/types/cms";
import PortalLogin from "@/components/portal/PortalLogin";
import PortalHome from "@/components/portal/PortalHome";
import BookExperiences from "@/components/portal/BookExperiences";
import RentMotorbike from "@/components/portal/RentMotorbike";
import OrderFood from "@/components/portal/OrderFood";
import MessageReception from "@/components/portal/MessageReception";
import ViewBill from "@/components/portal/ViewBill";
import ViewPackages from "@/components/portal/ViewPackages";
import MyBookings from "@/components/portal/MyBookings";
import RequestReceived from "@/components/portal/RequestReceived";
import { usePortalRecords } from "@/lib/usePortalRecords";
import { clearPortalToken } from "@/lib/portalRepo";

// ---------------------------------------------------------------------------
// Guest Portal — phone-number login, book tours, rent bikes, view bookings.
// Dark theme with gold accents matching Marina Terrace branding.
//
// Records come from usePortalRecords(): the server-side Guest Portal API
// (signed session, scoped strictly to this guest's phone) with a demo blob
// fallback. Guests always create REQUESTED intents; the owner confirms +
// records payment in admin. Payment UI (GCashQR) is only shown after an
// actual confirmation — never after a mere request.
// ---------------------------------------------------------------------------

export type PortalView =
  | "login"
  | "home"
  | "tours"
  | "rentals"
  | "food"
  | "messages"
  | "bill"
  | "packages"
  | "bookings"
  | "request";

export interface PortalGuest {
  phone: string;
  name: string;
}

export interface PortalBookingResult {
  type: "tour" | "rental";
  reference: string;
  name: string;
  date: string;
  amount: number;
  pax?: number;
  days?: number;
}

const GOLD = "#C6A15B";
const DARK = "#1a1a2e";

export default function Portal() {
  const { data } = useCms();
  const [view, setView] = useState<PortalView>("login");
  const [guest, setGuest] = useState<PortalGuest | null>(null);
  const [bookingResult, setBookingResult] = useState<PortalBookingResult | null>(null);
  const { records } = usePortalRecords(guest);

  const handleLogin = useCallback((phone: string, name: string) => {
    setGuest({ phone, name });
    setView("home");
  }, []);

  const handleLogout = useCallback(() => {
    clearPortalToken();
    setGuest(null);
    setView("login");
    setBookingResult(null);
  }, []);

  const handleRequestComplete = useCallback((result: PortalBookingResult) => {
    setBookingResult(result);
    setView("request");
  }, []);

  const handleRequestDone = useCallback(() => {
    setBookingResult(null);
    setView("bookings");
  }, []);

  return (
    <div
      className="min-h-screen font-sans"
      style={{ backgroundColor: DARK, color: "#e8e8e8" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-50 border-b px-3 py-2.5 sm:px-4 sm:py-3"
        style={{ backgroundColor: DARK, borderColor: `${GOLD}33` }}
      >
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide sm:text-sm" style={{ color: GOLD }}>
              MARINA TERRACE
            </span>
          </div>
          {guest && (
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-[11px] opacity-60 sm:text-xs">Hello, {guest.name}</span>
              <button
                onClick={handleLogout}
                className="rounded-full px-2.5 py-1 text-[11px] transition sm:px-3 sm:text-xs"
                style={{ border: `1px solid ${GOLD}55`, color: GOLD }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-lg px-3.5 py-5 sm:px-4 sm:py-6">
        {view === "login" && <PortalLogin onLogin={handleLogin} />}

        {view === "home" && guest && (
          <PortalHome
            guest={guest}
            tours={catalogTours}
            motorbikes={catalogMotorbikes}
            records={records}
            onNavigate={setView}
          />
        )}

        {view === "tours" && guest && (
          <BookExperiences
            guest={guest}
            tours={catalogTours}
            onComplete={handleRequestComplete}
            onBack={() => setView("home")}
          />
        )}

        {view === "rentals" && guest && (
          <RentMotorbike
            guest={guest}
            motorbikes={catalogMotorbikes}
            onComplete={handleRequestComplete}
            onBack={() => setView("home")}
          />
        )}

        {view === "food" && guest && (
          <OrderFood
            guest={guest}
            onOrderComplete={() => setView("home")}
            onBack={() => setView("home")}
          />
        )}

        {view === "messages" && guest && (
          <MessageReception
            guest={guest}
            onBack={() => setView("home")}
          />
        )}

        {view === "bill" && guest && (
          <ViewBill
            guest={guest}
            bookings={records.bookings}
            tourBookings={records.tourBookings}
            rentals={records.rentals}
            foodOrders={records.foodOrders}
            payments={records.payments}
            onBack={() => setView("home")}
          />
        )}

        {view === "packages" && (
          <ViewPackages
            onBack={() => setView("home")}
          />
        )}

        {view === "bookings" && guest && (
          <MyBookings
            guest={guest}
            bookings={records.bookings}
            tourBookings={records.tourBookings}
            rentals={records.rentals}
            onBack={() => setView("home")}
          />
        )}

        {view === "request" && bookingResult && (
          <RequestReceived
            booking={bookingResult}
            onViewBookings={handleRequestDone}
            onHome={() => {
              setBookingResult(null);
              setView("home");
            }}
          />
        )}
      </main>
    </div>
  );
}
