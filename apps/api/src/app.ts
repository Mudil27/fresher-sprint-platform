import cors from "@fastify/cors";
import { createDb, type Database } from "@qtp/db";
import { createRedis, type Redis } from "@qtp/bus";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth.js";
import { registerMetrics } from "./metrics.js";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import {
  fresherAdminRoutes,
  fresherExportRoutes,
} from "./routes/fresher-admin.js";
import { challengeRoutes } from "./routes/challenges.js";
import { orderRoutes } from "./routes/orders.js";
import { marketRoutes } from "./routes/market.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { adminRoutes } from "./routes/admin.js";
import { loanRoutes } from "./routes/loans.js";
import { optionRoutes } from "./routes/options.js";
import { bondEtfRoutes } from "./routes/markets.js";
import { otcRoutes } from "./routes/otc.js";
import { auctionRoutes } from "./routes/auctions.js";
import { voteRoutes } from "./routes/votes.js";
import { registerTraderVisibilityGuard } from "./visibility.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    redis: Redis;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Two JSON log lines per request cost real CPU at event load; production
    // logs only warnings/errors unless API_REQUEST_LOGS=1.
    disableRequestLogging:
      env.nodeEnv === "production" && process.env.API_REQUEST_LOGS !== "1",
    logger: {
      level: env.nodeEnv === "production" ? "info" : "debug",
      transport:
        env.nodeEnv === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
  });

  app.decorate("db", createDb(env.databaseUrl));
  app.decorate("redis", createRedis(env.redisUrl));

  await app.register(cors, {
    origin:
      env.corsOrigins.length === 1 && env.corsOrigins[0] === "*"
        ? true
        : env.corsOrigins,
    credentials: true,
  });

  await registerAuth(app);
  registerMetrics(app);
  registerTraderVisibilityGuard(app);

  app.get("/api/health", async () => ({ status: "ok", ts: Date.now() }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(challengeRoutes, { prefix: "/api/challenges" });
  await app.register(orderRoutes, { prefix: "/api/orders" });
  await app.register(marketRoutes, { prefix: "/api/market" });
  await app.register(portfolioRoutes, { prefix: "/api/portfolio" });
  await app.register(leaderboardRoutes, { prefix: "/api/leaderboard" });
  await app.register(fresherAdminRoutes, { prefix: "/api/admin/fresher" });
  await app.register(fresherExportRoutes, { prefix: "/api/admin/export" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(loanRoutes, { prefix: "/api/loans" });
  await app.register(optionRoutes, { prefix: "/api/options" });
  await app.register(bondEtfRoutes, { prefix: "/api/markets" });
  await app.register(otcRoutes, { prefix: "/api/otc" });
  await app.register(auctionRoutes, { prefix: "/api/auctions" });
  await app.register(voteRoutes, { prefix: "/api/votes" });

  return app;
}
