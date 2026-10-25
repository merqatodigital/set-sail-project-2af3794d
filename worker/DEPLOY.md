# Deploying the Talla Agent Worker (production)

The Worker in this folder is TALA's full agent backend (tool-calling chat,
bookings from conversation, owner back-office tools incl. Step 1 finance).
It is **code-complete and verified**; this runbook is the last mile: deploy
it to the production Cloudflare account and connect the site to it.

**Verified in-repo (2026-10-25, commit d832925 + CORS fix):**
- `npm run typecheck` — clean
- `npm test` — 302/303 (1 pre-existing stale failure in phase6,
  "verify file creation", also failing on main before this work)
- `npx wrangler deploy --dry-run` — bundles cleanly (3.35 MB upload)
- CORS allows `X-Idempotency-Key` / `X-Chat-Session-Id` (talaClient headers)

---

## 1. Log in (your Cloudflare account — cannot be done from CI/sandbox)

```bash
cd worker
npm install
npx wrangler login        # opens browser; use the merqato.digital account
npx wrangler whoami       # confirm account 2a51cf4fe2181cb0085fe8ffb9960009
```

## 2. Apply D1 migrations to the production database

Production D1 `talla-resort-db` (`4cf66029-e11c-4ba9-a974-135adce8abfa`,
already referenced in `wrangler.jsonc`):

```bash
npx wrangler d1 migrations list talla-resort-db --remote   # what's applied
npx wrangler d1 migrations apply talla-resort-db --remote  # apply the rest
```

Note: two files share the `0005` prefix (`0005_phase6_computer.sql`,
`0005_seed_menu_items.sql`). Wrangler applies both in filename order; if it
ever refuses the duplicate prefix, apply files individually with
`npx wrangler d1 execute talla-resort-db --remote --file=migrations/<file>`.

## 3. Set secrets (server-only; never commit, never VITE_-prefix)

```bash
npx wrangler secret put OPENROUTER_API_KEY          # your new OpenRouter key
npx wrangler secret put SUPABASE_URL                # https://nfirbrpnmgsrvoomtokn.supabase.co
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # Supabase → Settings → API → service_role
```

`SUPABASE_ANON_KEY` is optional (fallback only). The finance and operations
tools read Supabase with the service-role key, inside the Worker only.

## 4. Deploy

```bash
npx wrangler deploy       # uses wrangler.jsonc → worker name "talla-agent"
```

Expected URL: `https://talla-agent.merqato-digital.workers.dev`

Smoke test:

```bash
curl https://talla-agent.merqato-digital.workers.dev/api/health
curl -X POST https://talla-agent.merqato-digital.workers.dev/api/talla/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello","tenantId":"marina_terrace","role":"guest","userId":"smoke-1"}'
```

## 5. Connect the site (Vercel)

In Vercel → project → Settings → Environment Variables, add:

```
VITE_TALA_WORKER_URL=https://talla-agent.merqato-digital.workers.dev
```

Then redeploy the site. From that moment the pipeline in
`src/lib/talaClient.ts` is: **Worker (full agent) → same-origin
`/api/tala/chat` → Supabase Edge Function**, in that order.

## 6. Prove it

1. Site widget: ask "What rooms do you have and what's the wifi like?"
2. Admin → TALA → Test TALA Live (signed in as owner): ask
   **"How did we do this month?"** — a real answer with revenue/costs/profit
   proves the Step 1 finance tools are live. "Who still owes us money?"
   proves `listOutstandingBalances`.
3. If answers come from the fallback instead (no finance data), check:
   `VITE_TALA_WORKER_URL` set + site redeployed, Worker secrets set,
   and `npx wrangler tail` while chatting.

## Rollback

```bash
npx wrangler rollback     # previous Worker version
```

Or simply remove `VITE_TALA_WORKER_URL` in Vercel and redeploy — the site
falls back to its same-origin chat (PR #5) automatically.
