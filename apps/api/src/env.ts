export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? 8000),
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: Number(process.env.JWT_EXPIRES_IN ?? 86400),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://qtp:qtp@localhost:5432/qtp",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  /** IITB ITC SSO; enabled whenever a project id is configured. */
  ssoProjectId: process.env.ITC_SSO_PROJECT_ID?.trim() ?? "",
  ssoBaseUrl: (
    process.env.ITC_SSO_BASE_URL ?? "https://sso.tech-iitb.org"
  ).replace(/\/+$/, ""),
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
