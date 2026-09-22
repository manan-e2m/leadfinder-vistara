# LeadFinder

Instant ICP-to-prospect engine for agency owners. An agency enters their domain, the system reads their
footprint, confirms their ICP in one AI pass, then sources, audits, verifies
and scores **20 real leads** against that ICP, each with a branded mini-audit
and an opener. Participants scan a QR code at the booth and watch their
shortlist build live.

## Quickstart

```bash
npm run setup        # install, prisma db push, seed benchmark corpus
npm run dev          # next dev on port 3100
```

Useful scripts:

| Script                | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run db:reset`    | Wipe the dev DB, re-push schema, re-seed              |
| `npm run precompute`  | Pre-compute runs for registered attendees (event day) |
| `npm run use:postgres`| Switch Prisma datasource to PostgreSQL (Supabase/Railway/RDS) |
| `npm run use:sqlite`  | Switch back to zero-setup SQLite for local dev        |
| `npm run typecheck`   | `tsc --noEmit`                                        |

The schema is provider-agnostic on purpose (no native enums/arrays), so the
same migrations work on SQLite and Postgres.

## Environment variables

All configuration is centralised in `src/lib/env.ts` — nothing else reads
`process.env`. Everything except `DATABASE_URL` is optional; absent keys make
the matching provider fall back to its mock.

### Core

| Var | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Prisma connection string (SQLite file or Postgres URL). |
| `APP_URL` | `http://localhost:3100` | Public base URL, used for links and brand callbacks. |
| `PROVIDER_MODE` | `auto` | `auto` = live adapter wherever its key exists, mock otherwise; `mock` = force all mocks; `live` = force all live (requires keys). |

### Provider keys

| Var | Feeds stage |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | Source — Places nearby/details search for local businesses. |
| `APOLLO_API_KEY` | Source — B2B contact search. |
| `PAGESPEED_API_KEY` | Audit — site performance. |
| `META_AD_LIBRARY_TOKEN` | Audit — active ad library lookups. |
| `PHONE_VERIFY_API_KEY` | Verify — phone number checks. |
| `EMAIL_VERIFY_API_KEY` | Verify — email deliverability checks. |
| `ANTHROPIC_API_KEY` | ICP confirmation, lead scoring, opener drafting (Claude). |
| `BENCHMARK_CORPUS_URL` | Benchmark corpus fetched by the seed script. |

### Outreach / CRM

| Var | Meaning |
| --- | --- |
| `GHL_API_KEY` / `GHL_LOCATION_ID` | GoHighLevel integration (push leads as contacts). |
| `HUBSPOT_ACCESS_TOKEN` | HubSpot integration token. |
| `RESEND_API_KEY` | Transactional email sending. |

### Operational limits

| Var | Default | Meaning |
| --- | --- | --- |
| `COST_CAP_CENTS` | `45` | Hard per-run spend budget in US cents, enforced by the worker (`CostCapExceeded` aborts the run). |
| `LLM_MODEL` | `claude-sonnet-4-5` | Claude model used for ICP/score/opener calls. |
| `LLM_MAX_TOKENS_PER_RUN` | `40000` | Token budget per run across LLM calls. |
| `SCAN_RATE_PER_MINUTE` | `6` | Per-IP fixed-window rate limit on the cost-bearing `/api/scan` endpoint. |
| `QUEUE_CONCURRENCY` | `6` | Max runs executing in parallel in the in-process queue. |
| `RUN_STALE_AFTER_MS` | `90000` | A non-terminal run untouched for this long (and not active in this process) is treated as orphaned by a restart and marked failed. |
| `OPS_TOKEN` | — | **Optional.** When set, the `/ops` dashboard and `/api/providers` require this shared secret (see below). When unset — the demo default — ops is open, exactly as during rehearsal. |

## Architecture one-pager

```
POST /api/scan
  └─ creates Workspace + Run rows (id = cuid → access token in URL)
  └─ queues job → in-process queue (QUEUE_CONCURRENCY workers)
        └─ executeRun(): stage pipeline
              1. route    — pick sourcing route (Places / Apollo / benchmark)
              2. capture  — reader for the agency's own site & footprint
              3. icp      — AI confirms the ICP from the footprint
              4. source   — candidate businesses from the chosen providers
              5. audit    — per-candidate: site, SEO, ads, e-commerce signals
              6. verify   — phone / email / business-status verification
              7. score    — rank against the confirmed ICP
              8. personalize — branded mini-audit + opener draft
  └─ progress polled from /api/run/[runId]/progress every 800ms
  └─ terminal → redirect to /results/[runId] (held-back + scored leads)
```

- **Mock vs live providers.** Each pipeline stage has a provider pair. With
  `PROVIDER_MODE=auto` (default), a stage goes live only when its key is
  present in the env; missing keys mean the deterministic mock runs, so the
  app is fully demo-able with zero keys and zero cost. Add one key, restart,
  and that single stage goes live.
- **Queue.** Deliberately an in-process pool with bounded concurrency and
  status read back from the DB, so progress works across reloads/devices.
  Swap `src/pipeline/queue.ts` for BullMQ/Redis if you outgrow one process.
- **Stale-run recovery** (`src/lib/runRecovery.ts`). If the server restarts
  mid-run, the run row can stay `queued`/`running` forever. Runs not in this
  process's active set that go `RUN_STALE_AFTER_MS` untouched are swept to
  `failed` with a clear message at startup (`reapStaleRuns`) and lazily
  whenever a stuck run is queried (`recoverIfStale`).
- **Per-lead failure isolation.** A failure while auditing/verifying a single
  candidate is logged to `FailureLog` and the lead is skipped — one bad
  domain cannot fail or slow the run for everyone.

### Security guards

- **SSRF — `src/lib/urlGuard.ts`.** The scan endpoint fetches whatever domain
  a visitor types. `assertPublicDomain` (full check incl. DNS resolution,
  used on raw user input) and `isBlockedHostSync` (cheap literal check used
  per-candidate) reject `localhost`, RFC1918, loopback, link-local
  (`169.254.169.254` cloud metadata), CGNAT and dot-internal hosts, plus
  public-IP-resolving domains pointing at private space.
- **Rate limit — `src/lib/rateLimit.ts`.** In-memory fixed-window limiter
  keyed by client IP; `SCAN_RATE_PER_MINUTE` caps cost-bearing scans per
  address. Redis swap-in if scaled beyond one instance.
- **Per-lead failure isolation** — see above.
- **Cuid URLs as access tokens.** Results and progress are readable by
  anyone holding the run's cuid URL — that is intentional: attendees scan
  from QR codes, and the app is demo read-only by design. Do not "fix" this
  with an auth wall before the conference.

## Ops dashboard (`/ops`)

Single-screen observability for the person running the booth:

- provider mode + per-provider live/mock status,
- queue depth (active · waiting · capacity),
- cache hit-rate per pool,
- recent runs (agency, status, leads, cost, duration),
- recent failures (stage, reason, offending URL),
- **runs snapshot** — `runsSnapshot.staleNonTerminal`: how many non-terminal
  runs are older than `RUN_STALE_AFTER_MS`, i.e. how many look orphaned by a
  restart and need recovery. Non-zero = check the logs / consider restart.

Data comes from `GET /api/providers`, polled every 3s.

**Ops guard.** Set `OPS_TOKEN` in the environment to protect this feed:

- `/api/providers` then returns `401` unless the request carries the token
  via `Authorization: Bearer <token>`, `x-ops-token: <token>` header, or
  `?token=<token>`.
- The `/ops` page shows a minimal token prompt; the token is stored in
  `sessionStorage`, verified once against the feed, and sent as
  `x-ops-token` with every poll afterwards.
- Leave `OPS_TOKEN` **unset** for the live demo — the dashboard stays open,
  exactly as today. Intended for use if ops is ever exposed on the public
  internet between events.

## Deployment notes

- Run `next start -p 3100` (or any Node host) after `npm run build`.
- For a hosted deployment switch the datasource to Postgres:
  `npm run use:postgres`, set `DATABASE_URL`, `npm run build`, and apply the
  schema with `prisma db push` (or migrate). One process only — the queue is
  in-memory and the rate limiter/cache are per-process.
- Set the provider keys you want live in the host's environment; set
  `COST_CAP_CENTS` and `SCAN_RATE_PER_MINUTE` to match what the exposure can
  absorb. Set `OPS_TOKEN` whenever the /ops URL is reachable by third parties.
- Before the event: `npm run precompute` warms runs for registered attendees
  and seeds caches so walk-in loads are fast.
- **Docker.** A multi-stage `Dockerfile` (node:20-alpine, non-root user,
  entrypoint converging the schema at boot) and a `docker-compose.yml` with a
  persistent volume for the SQLite database are included —
  `docker compose up --build` gives a full local stack. For a hosted
  deployment switch the datasource to Postgres: