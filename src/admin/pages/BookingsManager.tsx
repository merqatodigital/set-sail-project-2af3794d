import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  LogIn,
  LogOut,
  Pencil,
  Trash2,
  CircleDollarSign,
  MessageCircle,
} from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useCms } from "@/context/CmsContext";
import { Button, Card, Field, Input, Textarea, Select, Modal } from "@/components/ui";
import { PageHeader, EmptyState } from "../shared/PageHeader";
import { OpsTable, OpsTH, OpsTD, StatusPill, KpiCard } from "../ops/OpsPrimitives";
import { useOperations } from "../ops/useOperations";
import { upsertBooking, deleteBooking, upsertPayment } from "@/lib/opsRepo";
import { sendWhatsAppTemplate } from "@/lib/whatsappSend";
import {
  formatPHP,
  formatDate,
  todayISO,
  nightsBetween,
  generateReference,
  textSearch,
  uid,
} from "../ops/opsUtils";
import type { Booking, BookingStatus, BookingSource } from "@/types/cms";

const emptyBooking = (): Booking => ({
  id: uid("bkg"),
  reference: generateReference("MT"),
  guestId: "",
  guestName: "",
  guestPhone: "",
  roomType: "Weekly Sprint",
  checkIn: todayISO(),
  checkOut: "",
  guests: 1,
  amount: 0,
  paidAmount: 0,
  status: "pending",
  source: "whatsapp",
  notes: "",
  packageId: "",
  createdAt: new Date().toISOString(),
});

export default function BookingsManager() {
  const { data: ops, refresh } = useOperations();
  const { data: cms } = useCms();
  const { notify } = useToast();
  const [editing, setEditing] = useState<Booking | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");

  const bookings = ops.bookings;
  const filtered = useMemo(() => {
    let list = textSearch(bookings, search, ["guestName", "reference", "roomType"]);
    if (statusFilter !== "all") list = list.filter((b) => b.status === statusFilter);
    return [...list].sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime());
  }, [bookings, search, statusFilter]);

  // KPIs
  const today = todayISO();
  const checkInsToday = bookings.filter(
    (b) => b.checkIn === today && b.status !== "cancelled",
  ).length;
  const checkOutsToday = bookings.filter(
    (b) => b.checkOut === today && b.status !== "cancelled",
  ).length;
  const inHouse = bookings.filter((b) => b.status === "checked_in").length;
  const revenue30 = bookings
    .filter((b) => new Date(b.createdAt) > new Date(Date.now() - 30 * 86400000))
    .reduce((s, b) => s + b.paidAmount, 0);

  const save = async (booking: Booking) => {
    const exists = bookings.some((b) => b.id === booking.id);
    const nights = nightsBetween(booking.checkIn, booking.checkOut);
    booking.notes = booking.notes || "";
    const ok = await upsertBooking(booking);
    if (!ok) {
      notify("Could not save booking", "info");
      return;
    }
    await refresh();
    notify(
      exists
        ? `Booking ${booking.reference} updated`
        : `Booking ${booking.reference} created (${nights} nights)`,
    );
    setEditing(null);
  };

  const setStatus = async (id: string, status: BookingStatus) => {
    const b = bookings.find((x) => x.id === id);
    if (!b) return;
    const ok = await upsertBooking({ ...b, status });
    if (!ok) {
      notify("Could not update status", "info");
      return;
    }
    await refresh();
    notify(`Booking ${status.replace("_", " ")}`);
  };

  const remove = async (b: Booking) => {
    if (!window.confirm(`Delete booking ${b.reference}? This cannot be undone.`)) return;
    const ok = await deleteBooking(b.id);
    if (!ok) {
      notify("Could not delete booking", "info");
      return;
    }
    await refresh();
    notify("Booking deleted");
  };

  const recordPayment = async (b: Booking) => {
    const raw = window.prompt(
      `Record payment for ${b.reference}\nOutstanding: ${formatPHP(b.amount - b.paidAmount)}\nAmount received (PHP):`,
      String(b.amount - b.paidAmount),
    );
    if (!raw) return;
    const amt = parseFloat(raw);
    if (isNaN(amt) || amt <= 0) return;
    const bookingOk = await upsertBooking({ ...b, paidAmount: b.paidAmount + amt });
    const paymentOk = await upsertPayment({
      id: uid("pay"),
      reference: generateReference("PAY"),
      date: todayISO(),
      category: "booking",
      direction: "in",
      amount: amt,
      method: "cash",
      relatedId: b.id,
      description: `Payment for ${b.reference} — ${b.guestName}`,
      notes: "",
    });
    if (!bookingOk || !paymentOk) {
      notify("Could not record payment", "info");
      return;
    }
    await refresh();
    notify(`${formatPHP(amt)} recorded`);
  };

  const sendReminder = async (b: Booking) => {
    const cloudApi = cms.settings.whatsapp.cloudApi;
    if (!cloudApi.enabled) {
      notify("Enable WhatsApp Cloud API in Admin -> WhatsApp first", "info");
      return;
    }
    if (!cloudApi.templates.bookingReminder) {
      notify("Set the Booking Reminder template name in Admin -> WhatsApp first", "info");
      return;
    }
    if (!b.guestPhone.trim()) {
      notify("Add a guest phone number to this booking first", "info");
      return;
    }
    setSendingReminder(b.id);
    const result = await sendWhatsAppTemplate(
      b.guestPhone,
      cloudApi.templates.bookingReminder,
      cloudApi.templateLanguage,
      [b.guestName, b.roomType, b.checkIn, b.reference],
    );
    setSendingReminder(null);
    notify(
      result.success ? `Reminder sent to ${b.guestName}` : result.error || "Send failed",
      result.success ? "success" : "info",
    );
  };

  return (
    <div>
      <PageHeader
        title="Bookings"
        description="Manage reservations, check-ins, check-outs and payments."
        actions={
          <Button onClick={() => setEditing(emptyBooking())}>
            <Plus className="h-4 w-4" /> New Booking
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Check-ins today"
          value={String(checkInsToday)}
          tone={checkInsToday ? "positive" : "default"}
        />
        <KpiCard label="Check-outs today" value={String(checkOutsToday)} />
        <KpiCard label="In house" value={String(inHouse)} sub="Currently staying" />
        <KpiCard label="Revenue (30d)" value={formatPHP(revenue30)} tone="positive" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#26221C]/30" />
          <Input
            placeholder="Search guest, reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="max-w-[180px]"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Checked in</option>
          <option value="checked_out">Checked out</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          description="Create your first booking to get started."
        />
      ) : (
        <OpsTable>
          <thead>
            <tr>
              <OpsTH>Reference</OpsTH>
              <OpsTH>Guest</OpsTH>
              <OpsTH>Room / Package</OpsTH>
              <OpsTH>Dates</OpsTH>
              <OpsTH>Amount</OpsTH>
              <OpsTH>Status</OpsTH>
              <OpsTH className="text-right">Actions</OpsTH>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => {
              const nights = nightsBetween(b.checkIn, b.checkOut);
              const owed = b.amount - b.paidAmount;
              return (
                <tr key={b.id} className="hover:bg-[#FAF6EF]/60">
                  <OpsTD>
                    <div className="font-mono text-xs text-[#26221C]/60">{b.reference}</div>
                    <div className="text-[10px] uppercase tracking-wide text-[#26221C]/35">
                      {b.source.replace(/_/g, " ")}
                    </div>
                  </OpsTD>
                  <OpsTD>
                    <div className="font-medium">{b.guestName || "—"}</div>
                    <div className="text-xs text-[#26221C]/45">
                      {b.guests} guest{b.guests !== 1 ? "s" : ""}
                    </div>
                  </OpsTD>
                  <OpsTD>{b.roomType}</OpsTD>
                  <OpsTD>
                    <div className="text-xs">
                      {formatDate(b.checkIn)} → {formatDate(b.checkOut)}
                    </div>
                    <div className="text-[10px] text-[#26221C]/45">
                      {nights} night{nights !== 1 ? "s" : ""}
                    </div>
                  </OpsTD>
                  <OpsTD>
                    <div className="font-medium">{formatPHP(b.amount)}</div>
                    <div className={`text-xs ${owed > 0 ? "text-red-600" : "text-green-700"}`}>
                      {owed > 0 ? `${formatPHP(owed)} owed` : "Paid"}
                    </div>
                  </OpsTD>
                  <OpsTD>
                    <StatusPill value={b.status} />
                  </OpsTD>
                  <OpsTD className="text-right">
                    <div className="flex justify-end gap-1">
                      {b.status === "confirmed" && (
                        <button
                          onClick={() => setStatus(b.id, "checked_in")}
                          className="rounded-md p-1.5 text-green-600 hover:bg-green-50"
                          title="Check in"
                        >
                          <LogIn className="h-4 w-4" />
                        </button>
                      )}
                      {b.status === "checked_in" && (
                        <button
                          onClick={() => setStatus(b.id, "checked_out")}
                          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Check out"
                        >
                          <LogOut className="h-4 w-4" />
                        </button>
                      )}
                      {owed > 0 && (
                        <button
                          onClick={() => recordPayment(b)}
                          className="rounded-md p-1.5 text-[#C6A15B] hover:bg-[#C6A15B]/10"
                          title="Record payment"
                        >
                          <CircleDollarSign className="h-4 w-4" />
                        </button>
                      )}
                      {(b.status === "pending" || b.status === "confirmed") &&
                        b.guestPhone.trim() && (
                          <button
                            onClick={() => sendReminder(b)}
                            disabled={sendingReminder === b.id}
                            className="rounded-md p-1.5 text-[#1EBE57] hover:bg-green-50 disabled:opacity-40"
                            title="Send WhatsApp reminder"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                        )}
                      <button
                        onClick={() => setEditing(b)}
                        className="rounded-md p-1.5 text-[#26221C]/50 hover:bg-[#26221C]/5"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(b)}
                        className="rounded-md p-1.5 text-red-400 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </OpsTD>
                </tr>
              );
            })}
          </tbody>
        </OpsTable>
      )}

      {editing && <BookingModal booking={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New/edit booking modal
// ---------------------------------------------------------------------------
function BookingModal({
  booking,
  onClose,
  onSave,
}: {
  booking: Booking;
  onClose: () => void;
  onSave: (b: Booking) => void;
}) {
  const [draft, setDraft] = useState<Booking>(booking);
  const patch = (p: Partial<Booking>) => setDraft((d) => ({ ...d, ...p }));
  const nights = nightsBetween(draft.checkIn, draft.checkOut);
  const owed = draft.amount - draft.paidAmount;
  const isNew = !booking.guestName;

  return (
    <Modal open onClose={onClose} title={isNew ? "New Booking" : `Edit ${booking.reference}`} wide>
      <div className="admin-scroll max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <Card className="grid gap-3 bg-[#FAF6EF] p-4 sm:grid-cols-2">
          <Field label="Reference">
            <Input value={draft.reference} onChange={(e) => patch({ reference: e.target.value })} />
          </Field>
          <Field label="Booking Source">
            <Select
              value={draft.source}
              onChange={(e) => patch({ source: e.target.value as BookingSource })}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="direct">Direct</option>
              <option value="walk_in">Walk-in</option>
              <option value="airbnb">Airbnb</option>
              <option value="agoda">Agoda</option>
              <option value="booking.com">Booking.com</option>
              <option value="referral">Referral</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Guest Name">
            <Input
              value={draft.guestName}
              onChange={(e) => patch({ guestName: e.target.value })}
              placeholder="Full name"
            />
          </Field>
          <Field label="Guest Phone / WhatsApp" hint="needed to send reminders">
            <Input
              value={draft.guestPhone}
              onChange={(e) => patch({ guestPhone: e.target.value })}
              placeholder="+63 917 123 4567"
            />
          </Field>
          <Field label="Room / Package">
            <Input
              value={draft.roomType}
              onChange={(e) => patch({ roomType: e.target.value })}
              placeholder="e.g. Weekly Sprint"
            />
          </Field>
          <Field label="Check-in">
            <Input
              type="date"
              value={draft.checkIn}
              onChange={(e) => patch({ checkIn: e.target.value })}
            />
          </Field>
          <Field label={`Check-out ${nights ? `— ${nights} night${nights !== 1 ? "s" : ""}` : ""}`}>
            <Input
              type="date"
              value={draft.checkOut}
              onChange={(e) => patch({ checkOut: e.target.value })}
            />
          </Field>
          <Field label="Number of Guests">
            <Input
              type="number"
              min={1}
              value={draft.guests}
              onChange={(e) => patch({ guests: parseInt(e.target.value) || 1 })}
            />
          </Field>
          <Field label="Status">
            <Select
              value={draft.status}
              onChange={(e) => patch({ status: e.target.value as BookingStatus })}
            >
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="checked_in">Checked in</option>
              <option value="checked_out">Checked out</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Total Amount (PHP)">
            <Input
              type="number"
              value={draft.amount}
              onChange={(e) => patch({ amount: parseFloat(e.target.value) || 0 })}
            />
          </Field>
          <Field label={`Paid Amount — ${owed > 0 ? formatPHP(owed) + " owed" : "Paid in full"}`}>
            <Input
              type="number"
              value={draft.paidAmount}
              onChange={(e) => patch({ paidAmount: parseFloat(e.target.value) || 0 })}
            />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea
            rows={2}
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Special requests, arrival time…"
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-3 border-t border-[#26221C]/10 pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSave(draft)} disabled={!draft.guestName.trim()}>
          Save Booking
        </Button>
      </div>
    </Modal>
  );
}
