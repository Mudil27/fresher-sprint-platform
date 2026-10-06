import bcrypt from "bcryptjs";
import { like } from "drizzle-orm";
import { createDb } from "./client.js";
import { users } from "./schema.js";

/**
 * Creates load-test / dry-run trader accounts `<prefix>0001..<prefix>N`
 * sharing one password. Refuses to run with NODE_ENV=production unless
 * ALLOW_TEST_USERS=1, so the event database never gets known passwords by
 * accident.
 *
 *   LOADTEST_USERS=400 LOADTEST_PREFIX=lt LOADTEST_PASSWORD=... pnpm --filter @qtp/db db:seed-loadtest
 */
async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_TEST_USERS !== "1"
  ) {
    throw new Error(
      "Refusing to create test users in production (set ALLOW_TEST_USERS=1 to override).",
    );
  }
  const count = Number(process.env.LOADTEST_USERS ?? 400);
  const prefix = process.env.LOADTEST_PREFIX ?? "lt";
  const password = process.env.LOADTEST_PASSWORD ?? "loadtest1234";
  if (!Number.isInteger(count) || count < 1 || count > 5000)
    throw new Error("LOADTEST_USERS must be an integer from 1 to 5000");
  if (!/^[a-z]{1,8}$/.test(prefix))
    throw new Error("LOADTEST_PREFIX must be 1-8 lowercase letters");

  const db = createDb();
  // One hash shared by every test account keeps seeding fast.
  const passwordHash = bcrypt.hashSync(password, 10);
  const rows = Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(4, "0");
    return {
      username: `${prefix}${n}`,
      displayName: `Test ${prefix.toUpperCase()}${n}`,
      email: `${prefix}${n}@loadtest.local`,
      passwordHash,
      role: "trader" as const,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(users)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.username, `${prefix}%`));
  console.log(
    `Test users ready: ${existing.length} accounts matching ${prefix}%, password from LOADTEST_PASSWORD.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
