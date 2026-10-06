export const env = {
  port: Number(process.env.GATEWAY_PORT ?? 8080),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://qtp:qtp@localhost:5432/qtp",
  jwtSecret: resolveJwtSecret(),
  /** Drop a connection if its outbound buffer exceeds this many bytes. */
  maxBufferedBytes: Number(process.env.GATEWAY_MAX_BUFFER ?? 1_000_000),
  heartbeatMs: Number(process.env.GATEWAY_HEARTBEAT_MS ?? 30000),
  /** Book/price updates are coalesced per symbol for this long (0 = off). */
  coalesceMs: Number(process.env.GATEWAY_COALESCE_MS ?? 200),
  /** Leaderboard rows sent to traders (their own row is always added). */
  leaderboardTop: Number(process.env.GATEWAY_LEADERBOARD_TOP ?? 20),
};

/** Production must never sign or accept tokens with the published dev secret. */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    (!secret || secret.length < 32 || secret.startsWith("dev-only"))
  )
    throw new Error(
      "JWT_SECRET must be set to a random value of at least 32 characters in production",
    );
  return (
    secret ?? "dev-only-change-me-0000000000000000000000000000000000000000"
  );
}
