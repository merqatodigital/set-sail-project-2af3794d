# TALA Agentic Wiring — Single Brain, Full Ops

Last updated: 2026-09-11

## Goal

One agentic TALA runs guest front desk **and** owner/admin back office:

- Room bookings (request → confirm → check-in/out)
- Tours (request → confirm)
- Motorbike rentals (request → confirm → fleet status)
- Staff roster + shifts
- Payroll (compute unpaid → mark paid)
- Payments ledger + guest folio
- Housekeeping / maintenance / food / inventory
- Morning briefing + Computer workspace

## Architecture (source of truth)

```
Browser (public orb / Admin Ask TALA / portal)
   │
   ▼
VITE_TALA_WORKER_URL  →  Cloudflare Worker (worker/src/index.ts)
   │
   ├─ POST /api/talla/chat     → TallaAgent Durable Object (LLM + tools)
   ├─ /api/ops/*               → staff / payroll / bookings / rentals (owner)
   ├─ /api/{tours,housekeeping,maintenance,menu,orders,inventory,settings,…}
   └─ /api/workflows/*         → daily briefing + approvals

TallaAgent tools  ──►  worker/src/db/repos/*
                      │
                      ├─ Supabase (service role): bookings, tala_*_requests,
                      │   staff_members, shifts, pay_records, payments,
                      │   motorbikes, motorbike_rentals, tour_bookings, folio
                      └─ D1: tours_catalog, menu, HK/maintenance, inventory,
                          talla_tasks, property_settings
```

Admin React pages still write via `src/lib/opsRepo.ts` (direct Supabase + admin
JWT). That is the **same** Postgres tables the Worker tools use. Prefer
`api.ops.*` (`src/lib/workerApi.ts`) for new Admin → Worker flows so auth and
business rules stay in one place.

## Tool map (owner/admin)

| Domain | Tools |
|---|---|
| Today / brief | `getTodayOperations`, `getResortOperations` |
| Bookings | `listBookings`, `listPendingRequests`, `requestRoomBooking`, `confirmBooking` / `confirmBookingRequest`, `checkInGuest`, `checkOutGuest`, `checkRoomAvailability` |
| Tours | `getTours`, `requestTour`, `confirmTour` |
| Rentals | `listMotorbikes`, `requestRental`, `confirmRental`, `updateMotorbikeStatus`, `getGuestMotorbikeState` |
| Staff / payroll | `listStaff`, `getPayrollSnapshot`, `listUnpaidPayRecords`, `runPayroll`, `markPayRecordPaid` |
| Money | `listPayments`, `logPayment`, `recordPayment` (folio) |
| Service | `createFoodOrder`, `requestHousekeeping`, `createMaintenanceRequest`, `getInventory`, HK/menu tools |
| Workspace | Computer tools (when enabled) |

Guest role never receives owner tools. Role comes from Worker auth (Supabase JWT
→ D1 `tenant_members`), never from the browser `role` field.

## HTTP endpoints added

```
GET  /api/ops/snapshot
GET  /api/ops/staff
GET  /api/ops/shifts
GET  /api/ops/payroll
POST /api/ops/payroll/run
POST /api/ops/payroll/mark-paid
GET  /api/ops/payments
POST /api/ops/payments
GET  /api/ops/bookings
GET  /api/ops/pending
POST /api/ops/confirm/booking
POST /api/ops/confirm/tour
POST /api/ops/confirm/rental
GET  /api/ops/motorbikes
PATCH /api/ops/motorbikes/status
```

All require owner/admin (`requireAdmin`).

## Dead / legacy paths (do not resurrect)

| Path | Status |
|---|---|
| `src/components/tala/talaTools.ts` browser tool loop writing `cms.operations` | **Legacy.** Chat no longer runs tools in-browser; `useTalaChat` → Worker only. Schemas kept for docs/edge fallback. |
| `supabase/functions/tala-chat` | Fallback only when Worker stream fails. |
| `services/hermes/*` | Parallel Hermes stack (Docker). Not the live public/admin path. |
| `cms_data.operations` JSON | Historical. Live ops are real tables. |

## Fixes landed in this pass

1. **Staff + payroll tools** on TallaAgent (were only in dead frontend tools).
2. **Confirm tour / confirm rental** promote pending requests into operational rows (parity with `confirmBooking`).
3. **`getTodayOperations`** now includes arrivals, pending queues, unpaid payroll, bike fleet — not only D1 HK/food.
4. **`executeTool` computerEnabled bug** — Computer tools were listed to the LLM but always “Unknown tool” at execute time.
5. **`/api/ops/*` routes + `api.ops` client** so Admin and agent share one surface.
6. **System prompt** documents the full owner tool surface.

## Verify

```bash
cd worker && npm test && npm run typecheck
# Live (with secrets):
curl -s "$WORKER/api/health" | jq .capabilities
# Owner JWT:
curl -s -H "Authorization: Bearer $TOKEN" "$WORKER/api/ops/snapshot" | jq .payroll
```

## Required Worker secrets

- `OPENROUTER_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (ops reads/writes)
- D1 binding + tenant_members row for each admin user
