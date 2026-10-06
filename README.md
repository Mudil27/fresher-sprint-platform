# Fresher Sprint Platform

A 30-minute live trading simulation for the Quant Club, IIT Bombay fresher orientation.
Around 400 participants trade the same live order books with virtual money while new
instruments list, a headline lands every minute and a bond pays coupons.

The whole stack runs on one host laptop with Docker, reachable over the LAN and,
optionally, through a named Cloudflare Tunnel.

## The game

| Game clock | What happens |
|---|---|
| 00:00 | AERIUM (Aerium Logistics) lists. Leaderboard hidden. |
| 05:00 | NEURO (Neuro-Chips) lists. Leaderboard shows the top 10 and your own rank. |
| 10:00 | SOLAR (Solar Grid) lists. Bond subscription opens (INR 5,000–20,000, one per participant). |
| 12:30 … 27:30 | Bond coupons every 2.5 minutes. |
| 15:00 | ORBIT (Orbital Mobility) lists. |
| 20:00 | Coupon, bond subscription closes, Market-X ETF lists (fair value 0.4 × AERIUM + 0.6 × NEURO). |
| 25:00 | 15-second pause, then the leaderboard is hidden for the final phase. |
| 30:00 | Bond principal returned, positions marked, final rankings revealed. |

One headline per minute (29 in total). Rules: positions between −100 and +100 per
instrument, at most 25 units per order and 10 open orders, no loans, leverage or
negative cash. Rule-breaking orders are rejected with a reason, never trimmed.
Ranking is final net worth (cash + positions marked at the closing mid).

A separate 5-minute **Fresher Warm-up** (AERIUM only, scores do not count) lets
participants practise first.

Schedule and rules live in `packages/shared/src/fresher-clock.ts` (public, browser-safe)
and `packages/shared/src/fresher-event.ts` (server-only headlines). Never import
`fresher-event.ts` from web code: it would ship the headlines to the browser.

## Architecture

pnpm + turbo monorepo, TypeScript throughout.

| Service | Role |
|---|---|
| `apps/web` | Next.js 15: homepage, login, trading floor, trading screen, admin |
| `apps/api` | Fastify REST API: auth, orders, market data, admin, Fresher setup and exports |
| `apps/gateway` | WebSocket fan-out of book, price, news and leaderboard updates |
| `apps/engine` | Single-writer matching engine per challenge, scripted timeline, bots, settlement |
| `apps/scoring` | Live leaderboard |
| `packages/core` | Pure matching and risk logic (strict exposure rules) |
| `packages/shared` | Types, schemas, Fresher schedule, WebSocket protocol |
| `packages/db` | Drizzle schema, seed scripts |
| `packages/bus` | Redis streams and pub/sub helpers |

Postgres is the system of record; Redis carries commands, events and hot state. In
the event stack, nginx serves `/` (web), `/api/` (API) and `/ws` (gateway) from one
origin, so the web build uses relative URLs and works on any host name.

The Fresher Sprint runs on the platform's `new_eden` challenge engine in its
`script` flow (`config.eden.script = "fresher-v1"` or `"warmup-v1"`). Older finals
features (options, OTC deals, auctions, votes) remain in the code but are switched off
and hidden for Fresher events.

## Docker startup (event stack)

Requirements: Docker Desktop (WSL2 backend on Windows), about 6 GB free RAM.

```bash
cp .env.example .env.event
```

Fill in `POSTGRES_PASSWORD`, `JWT_SECRET` and `ADMIN_PASSWORD` (generate secrets with
`openssl rand -hex 32`; the admin password needs 12+ characters). Then:

```bash
docker compose -f docker-compose.event.yml --env-file .env.event up -d --build
```

(`pnpm event:up` runs the same command.) The `migrate` service creates the schema and
the `admin` account; no demo traders or challenges are created. Open
`http://localhost/` on the host or `http://<host-lan-ip>/` from other devices.

With the Cloudflare Tunnel (set `CLOUDFLARE_TUNNEL_TOKEN` first):

```bash
docker compose -f docker-compose.event.yml --env-file .env.event --profile tunnel up -d
```

Stop with `docker compose -f docker-compose.event.yml --env-file .env.event down`
(add `-v` only if you mean to delete the event database).

## Local development (without Docker for the apps)

Requirements: Node 20+, pnpm 11 (`corepack enable`), Docker for Postgres and Redis.

```bash
pnpm install
cp .env.example .env      # then follow section 2 of the file
pnpm infra:up             # Postgres + Redis from docker-compose.yml
pnpm db:push && pnpm db:seed
pnpm dev                  # http://localhost:3000
```

With the default `SEED_DEMO_DATA`, the seed also creates demo accounts and practice
challenges for development. On Linux hosts where Postgres connections reset through
the Docker proxy, start the databases with
`docker compose -f docker-compose.yml -f docker-compose.linux-hostnet.yml up -d`.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `/` | Everyone | Fresher Sprint homepage and event rules |
| `/login` | Everyone | Username/password login (development fallback until ITC SSO) |
| `/challenges` | Participants | Trading floor: lists the Fresher Warm-up and Fresher Sprint (admins see every challenge) |
| `/challenges/<id>` | Participants | Trading screen: markets, order book, ticket, portfolio, news, leaderboard |
| `/admin` | Admin | All challenges and lifecycle controls |
| `/admin/fresher` | Admin | Fresher setup, live timeline, host-fired fallback, CSV exports, reset |
| `/api/health` | Everyone | Health check |
| `/ws` | Signed-in users | Real-time feed |

Admin API used by `/admin/fresher`:

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/fresher` | Create or reschedule a game: `{ script: "fresher-v1" \| "warmup-v1", bots: "none" \| "passive" \| "active", startsAt, bondTerms? }` (409 once in progress) |
| `GET /api/admin/<id>/cues` | Timeline (cue sheet) with status |
| `POST /api/admin/<id>/script-mode` | `{ manual: true }` holds the automatic schedule so the host fires beats by hand |
| `POST /api/admin/<id>/cues/run` | Fire the next beat `{ cueId }` (in order, once each) |
| `POST /api/admin/<id>/reset` | Reset a test challenge (pause it first if live) |
| `GET /api/admin/export/<id>/{rankings,trades,headlines}.csv` | Exports |

## Admin access

The `migrate` service creates one admin account: username `admin`, password
`ADMIN_PASSWORD` from `.env.event`. Sign in at `/login`, then open `/admin/fresher`:

1. Choose **Fresher Sprint** or **Warm-up**, the bot mode and the start time, and save.
   `passive` (two light market makers) is the default event mode; `none` is for load
   tests; `active` adds momentum bots for experiments.
2. The game starts itself at the start time and runs the whole schedule.
3. If anything goes wrong, switch to manual mode and fire the remaining beats from the
   timeline. Firing in order keeps the schedule consistent.
4. After the closing bell, download the CSV exports.

The bond's total return (default 1.5×) is configurable in the setup form.

## Trader access

Until ITC SSO is integrated, traders sign in with a username and password at
`/login`. Self-registration is closed (`/api/auth/register` returns 403); accounts are
created by the organisers.

For rehearsals, create disposable accounts `lt0001…ltNNNN` that share one password.
The script refuses to run with `NODE_ENV=production` unless `ALLOW_TEST_USERS=1`, so
never run it against the real event database:

```bash
docker compose -p <project> -f docker-compose.event.yml --env-file .env.event run --rm \
  -e ALLOW_TEST_USERS=1 -e LOADTEST_USERS=20 -e LOADTEST_PASSWORD=<test-password> \
  migrate pnpm --filter @qtp/db exec tsx src/seed-loadtest.ts
```

(Locally: `LOADTEST_USERS=20 LOADTEST_PASSWORD=<test-password> pnpm db:seed-loadtest`.)

Participants should enrol before the start; their first order also enrols them.

## Dry runs

`scripts/dryrun-fresher.mjs` creates (or reschedules) the Fresher Sprint, connects
six test traders and an admin observer, trades at fixed game times and prints a
PASS/FAIL checklist (32 checks: listings, headlines, order limits, bond window and
coupons, the pause, leaderboard phases, settlement and the final reveal).

1. Run the engine on a fast clock: set `ENGINE_MINUTE_MS=6000` in `.env.event` and
   recreate the engine (`... up -d --no-deps --force-recreate engine`). The 30-minute
   game then takes 3 minutes.
2. Create at least six test accounts (above).
3. Reset the Fresher Sprint from `/admin/fresher` if it has already run.
4. Run:

```bash
API_URL=http://localhost WS_URL=ws://localhost MINUTE_MS=6000 BOTS=passive \
ADMIN_PASS=<admin-password> JWT_SECRET=<jwt-secret> node scripts/dryrun-fresher.mjs
```

`LEAD_SEC` (default 20) sets the wall seconds before the open, useful for opening the
trader view first. Set `ENGINE_MINUTE_MS` back to `60000` afterwards.

`scripts/loadtest-fresher.mjs` is the multi-process load generator. Run it from a
second machine: a same-machine 400-user test on Windows measures Docker Desktop's port
forwarding, not the platform.

## Tests

```bash
pnpm build && pnpm typecheck && pnpm test
```

Known issue: one API test, `otc.test.ts > exposes stored loan schedules on request,
list and portfolio`, fails. The failure predates the Fresher work and is in the
finals-only OTC feature, which Fresher events do not use.

On Windows without Developer Mode, `next build` cannot create the symlinks for the
standalone output and fails at the very end; the Docker image builds normally.

## Planned: IITB ITC SSO

Not implemented yet. Login will move to the official IITB ITC SSO (OAuth/OIDC or SAML)
once ITC provides the protocol, callback URL, credentials, user fields and test access.

- Planned callback (OIDC redirect URI or SAML ACS) to register with ITC:
  `https://<event-domain>/api/auth/itc/callback`
- Placeholders are in section 4 of `.env.example`; the code does not read them yet.
- Only minimal identity will be stored. IITB passwords are never handled by this
  platform, and there will be no custom OTP or email flow.
- Participants keep a self-chosen display name: 3–20 characters, unique,
  profanity-filtered, locked when trading starts, renamable by the admin.
- The username/password login stays as a development and emergency fallback.

## Secrets

Never commit `.env`, `.env.event`, tunnel tokens or database dumps (all are in
`.gitignore`). `JWT_SECRET` must be identical for the API and gateway; the development
default is refused in production.
