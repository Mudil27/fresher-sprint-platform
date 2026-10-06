import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { challenges, participants } from "@qtp/db";

type ChallengeRow = typeof challenges.$inferSelect;

/**
 * Short-lived per-process cache for the challenge row on hot trader routes
 * (order entry, polling). The engine re-checks status and freezes, and admin
 * routes always read Postgres, so a ~1 s stale read only delays the
 * API-side fast rejection of an order the engine would reject anyway.
 */
const TTL_MS = Number(process.env.API_CHALLENGE_CACHE_MS ?? 1000);

const rows = new Map<
  string,
  { at: number; value: Promise<ChallengeRow | undefined> }
>();
const counts = new Map<string, { at: number; value: Promise<number> }>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fresh<T>(
  cache: Map<string, { at: number; value: Promise<T> }>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = load();
  cache.set(key, { at: now, value });
  // A failed read must not be served from the cache.
  value.catch(() => cache.delete(key));
  if (cache.size > 1000) cache.clear();
  return value;
}

/** Challenge by id or slug, cached for TTL_MS. */
export function cachedChallenge(
  app: FastifyInstance,
  idOrSlug: string,
): Promise<ChallengeRow | undefined> {
  if (TTL_MS <= 0) return loadChallenge(app, idOrSlug);
  return fresh(rows, idOrSlug, () => loadChallenge(app, idOrSlug));
}

function loadChallenge(
  app: FastifyInstance,
  idOrSlug: string,
): Promise<ChallengeRow | undefined> {
  return app.db.query.challenges.findFirst({
    where: UUID.test(idOrSlug)
      ? eq(challenges.id, idOrSlug)
      : eq(challenges.slug, idOrSlug),
  });
}

/** Participant count for a challenge, cached for TTL_MS. */
export function cachedParticipantCount(
  app: FastifyInstance,
  challengeId: string,
): Promise<number> {
  return fresh(counts, challengeId, async () => {
    const [row] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(participants)
      .where(eq(participants.challengeId, challengeId));
    return row?.count ?? 0;
  });
}
