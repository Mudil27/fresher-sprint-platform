import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getLeaderboard } from "@qtp/bus";
import { challenges, trades, users } from "@qtp/db";
import {
  defaultScoringFor,
  fresherChallengeConfig,
  gameClockLabel,
  redisKeys,
  scriptDurationMinutes,
  scriptHeadlines,
  type LeaderboardEntry,
} from "@qtp/shared";
import { serializeChallenge } from "../serialize.js";
import { validate } from "../util.js";

const SETUP = {
  "fresher-v1": {
    slug: "fresher-sprint",
    name: "Fresher Sprint",
    description:
      "30-minute live trading game: one instrument at the open, a new one every 5 minutes, a headline every minute, a bond from 10:00 to 20:00, the Market-X ETF at 20:00 and the closing bell at 30:00. Ranked on final net worth.",
    leaderboardHidden: true,
  },
  "warmup-v1": {
    slug: "fresher-warm-up",
    name: "Fresher Warm-up",
    description:
      "5-minute practice on AERIUM: market orders, limit orders and cancelling. Scores do not count.",
    leaderboardHidden: false,
  },
} as const;

const zSetup = z.object({
  script: z.enum(["fresher-v1", "warmup-v1"]),
  /** Liquidity bots for this run (compared in dry runs). */
  bots: z.enum(["none", "passive", "active"]).default("passive"),
  /** Opening bell; null leaves the challenge as a draft. */
  startsAt: z.string().datetime().nullable().optional(),
  bondTerms: z
    .object({
      totalReturn: z.number().min(1).max(5).optional(),
      minPrincipal: z.number().positive().optional(),
      maxPrincipal: z.number().positive().optional(),
    })
    .optional(),
});

/**
 * One-call setup for the Fresher Sprint and its warm-up: creates the
 * challenge from the preset, or rewrites it while still draft/scheduled
 * (calibrated bond terms, a new start time). A challenge that has started
 * must be reset first.
 */
export async function fresherAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.post("/", async (req, reply) => {
    const input = validate(zSetup, req.body, reply);
    if (!input) return;
    const setup = SETUP[input.script];
    const terms = input.bondTerms ?? {};
    if (
      terms.minPrincipal != null &&
      terms.maxPrincipal != null &&
      terms.minPrincipal > terms.maxPrincipal
    )
      return reply.code(400).send({ error: "invalid_bond_terms" });
    const config = fresherChallengeConfig(input.script, terms, input.bots);
    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const status = startsAt ? ("scheduled" as const) : ("draft" as const);

    const existing = await app.db.query.challenges.findFirst({
      where: eq(challenges.slug, setup.slug),
    });
    if (existing) {
      if (existing.status !== "draft" && existing.status !== "scheduled")
        return reply.code(409).send({ error: "challenge_in_progress" });
      // A fresh run always starts on the automatic clock.
      await app.redis.del(redisKeys.scriptManual(existing.id));
      const [updated] = await app.db
        .update(challenges)
        .set({
          name: setup.name,
          description: setup.description,
          type: "new_eden",
          status,
          config,
          scoring: defaultScoringFor("new_eden"),
          startsAt,
          endsAt: null,
          frozen: false,
          leaderboardHidden: setup.leaderboardHidden,
        })
        .where(eq(challenges.id, existing.id))
        .returning();
      return serializeChallenge(updated!);
    }
    const [created] = await app.db
      .insert(challenges)
      .values({
        slug: setup.slug,
        name: setup.name,
        description: setup.description,
        type: "new_eden",
        status,
        config,
        scoring: defaultScoringFor("new_eden"),
        startsAt,
        leaderboardHidden: setup.leaderboardHidden,
        createdBy: req.user.sub,
      })
      .returning();
    return reply.code(201).send(serializeChallenge(created!));
  });
}

/* ---- CSV exports (admin only) ---- */

/** RFC 4180 cell; a leading = + - @ is neutralised so names cannot run as formulas. */
function cell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text) && !/^-?\d/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export async function fresherExportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  async function load(id: string) {
    if (!z.string().uuid().safeParse(id).success) return null;
    return (
      (await app.db.query.challenges.findFirst({
        where: eq(challenges.id, id),
      })) ?? null
    );
  }

  // Final standings once settled, else the live board.
  app.get("/:challengeId/rankings.csv", async (req, reply) => {
    const challenge = await load((req.params as { challengeId: string }).challengeId);
    if (!challenge) return reply.code(404).send({ error: "not_found" });
    const entries: LeaderboardEntry[] =
      (challenge.finalResults as LeaderboardEntry[] | null) ??
      (await getLeaderboard(app.redis, challenge.id)) ??
      [];
    const body = csv(
      ["rank", "display_name", "username", "net_worth", "cash", "realized_pnl", "volume", "trades", "positions", "final"],
      entries.map((e) => [
        e.rank,
        e.displayName,
        e.username,
        (e.netWorth ?? e.settlement ?? e.pnl).toFixed(2),
        e.cash?.toFixed(2) ?? "",
        e.metrics?.realizedPnl.toFixed(2) ?? "",
        e.metrics?.volume ?? "",
        e.metrics?.trades ?? "",
        (e.assets ?? []).map((a) => `${a.symbol}:${a.quantity}`).join(" "),
        challenge.finalResults ? "yes" : "live",
      ]),
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${challenge.slug}-rankings.csv"`)
      .send(body);
  });

  // Every executed trade with game-clock time and both sides (bots blank).
  app.get("/:challengeId/trades.csv", async (req, reply) => {
    const challenge = await load((req.params as { challengeId: string }).challengeId);
    if (!challenge) return reply.code(404).send({ error: "not_found" });
    const buyer = alias(users, "buyer");
    const seller = alias(users, "seller");
    const rows = await app.db
      .select({
        executedAt: trades.executedAt,
        symbol: trades.symbol,
        price: trades.price,
        quantity: trades.quantity,
        takerSide: trades.takerSide,
        buyer: buyer.username,
        seller: seller.username,
      })
      .from(trades)
      .leftJoin(buyer, eq(trades.buyerId, buyer.id))
      .leftJoin(seller, eq(trades.sellerId, seller.id))
      .where(eq(trades.challengeId, challenge.id))
      .orderBy(asc(trades.executedAt));
    const script = challenge.config.eden?.script;
    const start = challenge.startsAt?.getTime();
    const end = challenge.endsAt?.getTime();
    const minuteMs =
      script && start != null && end != null
        ? (end - start) / scriptDurationMinutes(script)
        : 60_000;
    const body = csv(
      ["executed_at", "game_clock", "symbol", "price", "quantity", "taker_side", "buyer", "seller"],
      rows.map((r) => [
        r.executedAt.toISOString(),
        start != null ? gameClockLabel(((r.executedAt.getTime() - start) / minuteMs) * 60) : "",
        r.symbol,
        r.price,
        r.quantity,
        r.takerSide,
        r.buyer ?? "bot",
        r.seller ?? "bot",
      ]),
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${challenge.slug}-trades.csv"`)
      .send(body);
  });

  // Post-event debrief: every headline with its hidden category and lesson.
  app.get("/:challengeId/headlines.csv", async (req, reply) => {
    const challenge = await load((req.params as { challengeId: string }).challengeId);
    if (!challenge) return reply.code(404).send({ error: "not_found" });
    const script = challenge.config.eden?.script;
    if (!script) return reply.code(409).send({ error: "not_fresher" });
    const body = csv(
      ["minute", "targets", "category", "fair_value_change", "momentum", "headline", "lesson"],
      scriptHeadlines(script).map((h) => [
        gameClockLabel(h.minute * 60),
        h.targets.join(" "),
        h.category,
        Object.entries(h.fv).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" "),
        Object.entries(h.momentum).map(([k, v]) => `${k} ${v > 0 ? "up" : "down"}`).join(" "),
        h.headline,
        h.lesson,
      ]),
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${challenge.slug}-headlines.csv"`)
      .send(body);
  });
}
