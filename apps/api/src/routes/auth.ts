import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { users } from "@qtp/db";
import { zLoginInput, type UserPublic } from "@qtp/shared";
import { env } from "../env.js";
import { validate } from "../util.js";
import { rateLimit } from "../ratelimit.js";

interface SsoProfile {
  name?: string;
  roll?: string;
  department?: string;
  degree?: string;
  passing_year?: number;
}

/** Looser than password login: a whole hall can share one campus IP. */
const ssoLimit = rateLimit({
  bucket: "sso-callback",
  limit: 300,
  windowMs: 60_000,
  by: "ip",
});

const authLimit = rateLimit({
  bucket: "auth",
  limit: 10,
  windowMs: 60_000,
  by: "ip",
});

function toPublic(u: typeof users.$inferSelect): UserPublic {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/register", { preHandler: [authLimit] }, async (_req, reply) => {
    return reply.code(403).send({ error: "registration_closed" });
  });

  app.post("/login", { preHandler: [authLimit] }, async (req, reply) => {
    const input = validate(zLoginInput, req.body, reply);
    if (!input) return;

    const found = await app.db.query.users.findFirst({
      where: eq(users.username, input.username),
    });
    if (!found || !(await bcrypt.compare(input.password, found.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    await app.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, found.id));

    const user = toPublic(found);
    const token = app.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return { token, user };
  });

  // ITC SSO: /sso/login sends the browser to ITC; ITC returns it to
  // /callback?accessid=<key>. The key is single-use, so it is exchanged here on
  // the server, never in the browser.
  app.get("/sso/login", async (_req, reply) => {
    if (!env.ssoProjectId) return reply.code(503).send({ error: "sso_disabled" });
    return reply.redirect(
      `${env.ssoBaseUrl}/project/${encodeURIComponent(env.ssoProjectId)}/ssocall/`,
    );
  });

  app.get<{ Querystring: { accessid?: string } }>(
    "/callback",
    { preHandler: [ssoLimit] },
    async (req, reply) => {
      const fail = (code: string) =>
        reply.redirect(`/login?error=${encodeURIComponent(code)}`);
      const accessId = req.query.accessid;
      if (!env.ssoProjectId) return fail("sso_disabled");
      if (!accessId || accessId.length > 512) return fail("sso_missing_key");

      let profile: SsoProfile;
      try {
        const res = await fetch(`${env.ssoBaseUrl}/project/getuserdata`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: accessId }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 403) return fail("sso_expired");
        if (!res.ok) return fail("sso_rejected");
        profile = (await res.json()) as SsoProfile;
      } catch (err) {
        req.log.error({ err }, "ITC SSO user data fetch failed");
        return fail("sso_unreachable");
      }

      const roll = String(profile.roll ?? "").trim().toLowerCase();
      const name = String(profile.name ?? "").trim().slice(0, 60);
      if (!/^[a-z0-9]{3,20}$/.test(roll) || !name) return fail("sso_rejected");

      let found = await app.db.query.users.findFirst({
        where: eq(users.username, roll),
      });
      if (found && found.role !== "trader") return fail("sso_rejected");
      if (!found) {
        // The password hash is random and never disclosed: SSO-only account.
        const [created] = await app.db
          .insert(users)
          .values({
            username: roll,
            displayName: name,
            passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
            role: "trader",
          })
          .onConflictDoNothing()
          .returning();
        found =
          created ??
          (await app.db.query.users.findFirst({
            where: eq(users.username, roll),
          }));
        if (!found) return fail("sso_rejected");
      }
      await app.db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, found.id));

      const token = app.jwt.sign({
        sub: found.id,
        username: found.username,
        role: found.role,
      });
      // Fragment, so the token is not sent to servers or logged by the proxy.
      return reply.redirect(`/login/complete#token=${token}`);
    },
  );

  app.get(
    "/me",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const found = await app.db.query.users.findFirst({
        where: eq(users.id, req.user.sub),
      });
      if (!found) return reply.code(404).send({ error: "not_found" });
      return toPublic(found);
    },
  );
}
