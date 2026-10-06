# AGENTS.md

Guide for AI coding agents working on the Fresher Sprint platform. Read `README.md`
first for setup, routes and the game schedule.

## Ground rules

1. **Reliability over features.** The event is a single 30-minute live session for
   about 400 participants on one host laptop. Prefer small, well-tested changes.
2. **Keep secrets out of git.** `.env`, `.env.event`, tunnel tokens and database dumps
   stay local. Use `.env.example` for new variables, with placeholders only.
3. **Never reset or modify real event data.** Test challenges (Fresher Sprint and
   Warm-up before event day) may be reset for dry runs.
4. **Do not leak the script.** `packages/shared/src/fresher-event.ts` (headlines and
   their hidden categories) is server-only. Web code may import only
   `fresher-clock.ts` and other headline-free modules; the package is
   `sideEffects: false` so unused exports are tree-shaken.
5. **Action IDs are versioned.** Never renumber `fresher-v1/*` or `warmup-v1/*` action
   IDs for a challenge that has run; completed actions are recorded in `event_actions`.

## Where things live

| Task | Start here |
|---|---|
| Schedule, instruments, bond, bot modes, challenge preset | `packages/shared/src/fresher-clock.ts` |
| Headlines, timeline actions, host cue sheet | `packages/shared/src/fresher-event.ts` |
| Strict risk (exposure rule, rejections, self-trade prevention) | `packages/core/src/engine.ts` |
| Engine runner, script flow, manual mode, final reveal | `apps/engine/src/runner.ts` |
| Timeline action handlers | `apps/engine/src/event-executor.ts` |
| Bond and Market-X | `apps/engine/src/markets-manager.ts` |
| Final settlement | `apps/engine/src/final-scoring.ts` |
| Fresher setup endpoint and CSV exports | `apps/api/src/routes/fresher-admin.ts` |
| Trading screen | `apps/web/src/app/challenges/[id]/page.tsx` |
| Admin setup page | `apps/web/src/app/admin/fresher/page.tsx` |
| Event Docker stack and nginx | `docker-compose.event.yml`, `infra/nginx/event/` |
| Dry run checklist | `scripts/dryrun-fresher.mjs` |

## Architecture invariants

- One engine process holds `qtp:lock:engine:{challengeId}` and is the only writer of a
  challenge's order books.
- The API never calls the engine directly; commands go through the Redis stream
  `qtp:cmd:{challengeId}`.
- The gateway is read-only for trading state.
- Postgres is the source of truth; Redis is hot state.
- `ENGINE_MINUTE_MS` is the game minute (60000 for the event); `ENGINE_TICK_MS` is the
  price/bot tick. They are different settings.
- Participant-facing wall-clock times are shown in IST (`apps/web/src/lib/time.ts`).

## Conventions

- Shared types and schemas go in `packages/shared` or `packages/db/src/schema.ts`.
- Match surrounding code; do not refactor unrelated files or reformat whole files.
- Run `pnpm typecheck` and `pnpm test` before engine or risk changes, and the dry run
  (`scripts/dryrun-fresher.mjs`) before anything that touches the schedule.
- Design: dark, dense trading-terminal style with tabular numbers (see `DESIGN.md`).
