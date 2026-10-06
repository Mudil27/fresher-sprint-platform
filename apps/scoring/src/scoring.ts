import { eq } from "drizzle-orm";
import { getPrice, getTraderMetricsMap, type Redis } from "@qtp/bus";
import { computeScore, profitPnl } from "@qtp/core";
import {
  challenges,
  getChallengeValuation,
  scoreSnapshots,
  type Database,
} from "@qtp/db";
import { isFresherEden, redisKeys, type LeaderboardEntry } from "@qtp/shared";

const lastSnapshot = new Map<string, number>();

export async function scoreChallenge(
  db: Database,
  redis: Redis,
  challengeId: string,
  { snapshotMs = 30000 }: { snapshotMs?: number } = {},
): Promise<void> {
  const finalKey = `qtp:final:${challengeId}`;
  if (await redis.exists(finalKey)) return;
  const challenge = await db.query.challenges.findFirst({
    where: eq(challenges.id, challengeId),
  });
  if (
    !challenge ||
    challenge.status !== "live" ||
    challenge.frozen ||
    challenge.finalizedAt ||
    challenge.finalResults != null
  )
    return;
  const valuation = await getChallengeValuation(db, challengeId, (symbol) =>
    getPrice(redis, challengeId, symbol),
  );
  if (!valuation) return;
  const metricsMap = await getTraderMetricsMap(redis, challengeId);
  const fresher = isFresherEden(challenge.config.eden);
  const entries: LeaderboardEntry[] = valuation.accounts
    .filter((account) => account.role !== "admin")
    .map((account) => {
      // Fresher Sprint ranks live net worth without locked bond principal.
      const marketValue = fresher
        ? account.marketValue - account.bondValue
        : account.marketValue;
      const pnl = profitPnl(
        account.cash,
        marketValue,
        account.startingCash,
        account.loanDebt,
      );
      const metrics = metricsMap.get(account.userId);
      const score = computeScore(
        {
          userId: account.userId,
          pnl,
          absInventory: account.absInventory,
          spreadCapture: metrics?.spreadCapture,
          quoteUptime: metrics?.quoteUptime,
        },
        valuation.challenge.scoring,
      );
      return {
        rank: 0,
        userId: account.userId,
        username: account.username,
        displayName: account.displayName,
        pnl,
        score,
        ...(metrics ? { metrics } : {}),
        ...(fresher
          ? {
              netWorth:
                Math.round((account.cash + marketValue - account.loanDebt) * 100) /
                100,
            }
          : {}),
      };
    });
  entries.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const now = Date.now();
  const snapshotDue =
    entries.length > 0 &&
    now - (lastSnapshot.get(challengeId) ?? 0) >= snapshotMs;
  const updated = await db.transaction(async (tx) => {
    // Serialize snapshots against the finalizer and the parent's lifecycle update.
    const [current] = await tx
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .for("share");
    if (
      !current ||
      current.status !== "live" ||
      current.frozen ||
      current.finalizedAt ||
      current.finalResults != null ||
      (await redis.exists(finalKey))
    )
      return false;
    if (snapshotDue) {
      await tx.insert(scoreSnapshots).values(
        entries.map((entry) => ({
          challengeId,
          userId: entry.userId,
          pnl: entry.pnl,
          score: entry.score,
          capturedAt: new Date(now),
        })),
      );
    }
    // SET and PUBLISH must both be gated atomically: a separate publish can race finalization.
    return (
      (await redis.eval(
        `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      redis.call('SET', KEYS[2], ARGV[1])
      redis.call('PUBLISH', KEYS[3], ARGV[2])
      return 1
    `,
        3,
        finalKey,
        redisKeys.leaderboard(challengeId),
        redisKeys.broadcastChannel(challengeId),
        JSON.stringify(entries),
        JSON.stringify([
          {
            target: "all",
            msg: { type: "leaderboard", challengeId, data: entries },
          },
        ]),
      )) === 1
    );
  });
  if (updated && snapshotDue) lastSnapshot.set(challengeId, now);
}
