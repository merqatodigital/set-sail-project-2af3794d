# Partner Dashboard — setup & operations

The homepage hero at `/` is now a private workspace for Merqato and James:
a status table of live projects, and a threaded comment system with images
and smart link chips underneath each row.

Nothing else on the site was changed, deleted or restructured.

---

## 1. What was added

| Path | Purpose |
| --- | --- |
| `content/updates.json` | **The project list.** Edit this to change the hero table. |
| `src/components/dashboard/PartnerDashboard.tsx` | The hero: heading, table, mobile cards, passcode gate, offline banner |
| `src/components/dashboard/Thread.tsx` | Per-project comment thread, replies, edit/delete, skeletons |
| `src/components/dashboard/CommentComposer.tsx` | Text + emoji + multi-image upload + multi-link fields |
| `src/components/dashboard/Lightbox.tsx` | Image viewer (Esc, arrow keys, focus trap) |
| `src/components/dashboard/EmojiPicker.tsx` | Dependency-free emoji picker |
| `src/components/dashboard/StatusBadge.tsx` | Live / In Progress / Planned / Blocked pills |
| `src/lib/partnerDashboard/config.ts` | **Every limit in one place** (see §5) |
| `src/lib/partnerDashboard/db.server.ts` | Supabase → Neon adapter with runtime probing |
| `src/lib/partnerDashboard/handlers.server.ts` | The `/api` route handlers |
| `src/lib/partnerDashboard/storage.server.ts` | Supabase Storage → Vercel Blob → base64 |
| `src/lib/partnerDashboard/api.ts` | Client data layer: optimistic writes, outbox, offline fallback |
| `src/lib/partnerDashboard/local.ts` | localStorage mirror + write outbox |
| `src/lib/partnerDashboard/compress.ts` | Canvas image compression (no dependency) |
| `src/lib/partnerDashboard/attach.ts` | URL → chip detection, auto-linking |
| `src/lib/partnerDashboard/sanitize.ts` | Server-side text sanitisation |
| `supabase/migrations/20261002000000_partner_dashboard.sql` | Schema + bucket + RLS |
| `supabase/migrations/20261002000100_partner_dashboard_hardening.sql` | Optional lockdown (§4) |

**Modified (small, surgical):**

- `src/pages/Home.tsx` — renders `<PartnerDashboard />` first and skips the CMS `hero` key
- `src/server.ts` — adds four `/api` branches, following the existing `/api/chat` pattern
- `package.json` — adds `@neondatabase/serverless` and `@vercel/blob` (both dynamic imports, server-only)
- `README.md` — appended a pointer to this file

**Untouched:** `src/components/site/Hero.tsx` still exists, unmodified. To restore
the original hero, delete the `<PartnerDashboard />` line and the
`if (section.key === "hero") return null;` filter in `src/pages/Home.tsx`.

---

## 2. Deploy the database (one step)

Supabase is already connected, so the runtime picks it up automatically — but
the tables do not exist yet. Until you create them the dashboard runs in
localStorage mode and shows the offline banner.

Paste the contents of
`supabase/migrations/20261002000000_partner_dashboard.sql`
into the **Supabase SQL Editor** and run it, or:

```sh
psql "$SUPABASE_DB_URL" -f supabase/migrations/20261002000000_partner_dashboard.sql
```

It creates `projects`, `comments`, `attachments`, `comment_revisions`,
`write_rate_limits`, the `comment-images` Storage bucket, all RLS policies, and
the `check_write_rate_limit()` function.

`comment_revisions` and `write_rate_limits` are **additions** to your spec:
your `comments.updated_at` column alone cannot keep an edit history (which you
asked for), and serverless instances share no memory, so the rate-limit
counter has to live in Postgres.

Verify by loading `/` — the footer line under the table should read
"Comments are stored in Supabase."

---

## 3. Add a project row

Edit `content/updates.json`:

```json
[
  {
    "id": "marina-terrace",
    "name": "Marina Terrace – Main Site",
    "status": "Live",
    "url": "https://set-sail-project.lovable.app",
    "image": "/images/hero-rooftop.jpg",
    "updated": "2026-02-14T15:42:00"
  }
]
```

- `status` must be one of `Live`, `In Progress`, `Planned`, `Blocked`
  (an unknown value renders a neutral grey pill instead of breaking).
- `image` is optional. Point it at anything in `public/` or a full URL.
- `updated` is a local ISO timestamp. The hero's "Last updated" line takes the
  newest value across all rows **and** the newest comment on any row, so
  posting a comment moves the line automatically.
- `id` must be stable — comments reference it.

---

## 4. Security: the one thing to tighten

Because no `SUPABASE_SERVICE_KEY` is set yet, the first migration has to grant
write access to the public (`anon`) key. The passcode is enforced at `/api`,
but somebody holding the publishable key — which ships in the browser bundle —
could talk to PostgREST directly and skip it.

To close that, in order:

1. Set `SUPABASE_SERVICE_KEY` in your environment.
2. Run `supabase/migrations/20261002000100_partner_dashboard_hardening.sql`.

After that only the server can write, and the passcode becomes the single,
unbypassable door. Public reads stay open, per your spec.

Also worth knowing:

- The default passcode is `5309` (set `DASHBOARD_PASSCODE` to change it).
  Because that is a 4-digit code, the server rate-limits passcode attempts to
  30 per IP per hour. Prefer a longer code if the threads ever hold anything
  sensitive.
- Writes are rate-limited per IP per hour: 20 comments, 10 uploads.
- Comment text is HTML-stripped server-side; the client renders it as React
  text nodes, never as HTML, so script injection has no path to the DOM.
- Uploaded files are validated by **magic bytes**, not by filename or the
  declared Content-Type.
- Edit/delete are author-only, checked **before** the write. Deletes are soft
  (`deleted_at` set, body cleared, row kept) and every edit stores the previous
  body in `comment_revisions`.

---

## 5. Tuning limits

All of these live in `src/lib/partnerDashboard/config.ts`:

```ts
IMAGE_LIMITS.maxBytesPerImage      // 10 MB, before compression
IMAGE_LIMITS.maxImagesPerComment   // 6
IMAGE_LIMITS.maxLinksPerComment    // 10
IMAGE_LIMITS.maxDimension          // 1800px longest edge after compression
IMAGE_LIMITS.quality               // 0.82
IMAGE_LIMITS.skipCompressionUnderBytes  // 200 KB — smaller files pass through
IMAGE_LIMITS.base64FallbackMaxBytes     // 500 KB
RATE_LIMITS.commentsPerHour        // 20
RATE_LIMITS.uploadsPerHour         // 10
AUTHORS / DEFAULT_AUTHOR           // James, Merqato
```

The server imports the same file, so client and server limits cannot drift.

---

## 6. How the pieces behave

**Optimistic UI.** A comment appears the instant you hit Post. It shows
`sending…` until the server confirms. If the write fails it stays put with a
**Retry** button; if the browser is offline it is queued and replayed
automatically.

**Offline.** When the backend is unreachable the UI reads from and writes to
localStorage and shows `offline — changes saved locally`. A write outbox keeps
ordering and flushes on the next successful read (including the automatic
45-second poll while a thread is open).

**Image uploads.** Compressed in the browser via canvas before upload — WebP
where supported, GIFs passed through untouched so animation survives. Uploads
start the moment you drop or paste files, so failures surface before you post.
Click any uploaded image to open the same lightbox as the hero previews.

**Smart chips.** Pasting a URL into the comment box immediately renders a chip:
📄 Drive/Docs/Sheets/Slides · 🎨 Figma · ▶️ YouTube/Vimeo · 📝 Notion ·
🖼️ direct image URLs (inline thumbnail) · 🔗 everything else. The `Add link`
button appends separate URL fields (max 10), stored as their own attachment
rows.

**Unread badge.** Opening a thread stamps a per-author "last seen" time in
localStorage; a row shows a gold **New** pill when a newer comment exists.

**Notifications.** Opening a thread starts a 45-second poll (paused when the
tab is hidden) so the other person's replies appear without a refresh.

---

## 7. API

All routes are serverless functions inside the existing Nitro/Worker entry
(`src/server.ts`) — this repo deploys to Cloudflare, so Vercel-style
`/api/*.js` files would never run.

| Method | Route | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/session` | passcode | Verifies the passcode, reports the active backend |
| `GET` | `/api/projects` | public | Seed rows + comment counts. Works with **no** database |
| `GET` | `/api/comments?project_id=` | public | Threaded comments + attachments |
| `POST` | `/api/comments` | passcode | Create a comment or a one-level reply |
| `PATCH` | `/api/comments?id=` | passcode + author | Edit; previous body saved to `comment_revisions` |
| `DELETE` | `/api/comments?id=&author=` | passcode + author | Soft delete |
| `POST` | `/api/upload` | passcode | Raw image bytes; magic-byte validated |

Write endpoints read the passcode from the `x-dashboard-passcode` header.
Responses carry `{ data, backend }`, or `{ error, code }` where `code` is one
of `DB_NOT_CONFIGURED`, `UNAUTHORIZED`, `RATE_LIMITED`, `BAD_REQUEST`. A
`DB_NOT_CONFIGURED` (503) is what tells the client to switch to localStorage.

`/api/session` is an addition to your endpoint list: without it the client has
no way to validate a stored passcode before showing the Unlocked state.

---

## 8. Known limitations

- **No real auth.** Identity is a name in localStorage — anyone with the URL
  and the passcode can post as either author. That matches "no full auth yet",
  but it is not a security boundary.
- **`bun.lock` is stale.** Two dependencies were added to `package.json` but
  the lockfile was not regenerated: this sandbox's bun (1.4.2) rewrote 164
  unrelated entries, dropping other-platform optional packages, which would
  have been worse than leaving it. Run `bun install` once on your own machine
  to refresh it, or keep using the `npm install` your CI already runs.
- **Pre-existing type error.** `npx tsc --noEmit` reports one error in
  `src/routes/__root.tsx` (`errorComponent` vs TanStack Router's
  `ErrorComponentProps`). It predates these changes and is unrelated; the
  production build passes.
- **Tailwind v4 `prefers-color-scheme`.** The site has no dark-mode stylesheet
  (the `ThemeProvider` remaps the owner's configured colours instead), so the
  dashboard matches the existing light palette and inherits those theme
  overrides through the same hex classes the rest of the site uses.
