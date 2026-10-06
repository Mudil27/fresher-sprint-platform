#!/usr/bin/env node
/**
 * Automated Fresher Sprint rehearsal. Creates (or re-schedules) the game via
 * POST /api/admin/fresher, connects a few test traders plus an admin
 * observer, makes scripted moves at fixed game times, and prints a PASS/FAIL
 * checklist of every scheduled beat and rule.
 *
 * Run the engine on a fast clock for a quick pass, e.g. ENGINE_MINUTE_MS=6000
 * (30 game minutes = 3 wall minutes), and pass the same MINUTE_MS here.
 * Needs Node 22+, test accounts from db:seed-loadtest, and the JWT secret.
 *
 *   ADMIN_PASS=... JWT_SECRET=... MINUTE_MS=6000 node scripts/dryrun-fresher.mjs
 *
 * Env: API_URL / WS_URL (default http://localhost / ws://localhost),
 *      USER_PREFIX (lt), MINUTE_MS (60000), LEAD_SEC (20, wall seconds to the open),
 *      BOTS (none | passive | active; default passive)
 */
import { createHmac } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost";
const WS = process.env.WS_URL ?? "ws://localhost";
const MINUTE_MS = Number(process.env.MINUTE_MS ?? 60_000);
const LEAD_SEC = Number(process.env.LEAD_SEC ?? 20);
const PREFIX = process.env.USER_PREFIX ?? "lt";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET is required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let startsAt = 0;
const gameSec = () => ((Date.now() - startsAt) / MINUTE_MS) * 60;
const clock = (s = gameSec()) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const waitGame = async (second) => {
  const ms = startsAt + (second * MINUTE_MS) / 60 - Date.now();
  if (ms > 0) await sleep(ms);
};

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json };
}

function sign(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const body = b({ ...payload, iat: now, exp: now + 4 * 3600 });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function main() {
  const admin = await api("POST", "/api/auth/login", null, {
    username: "admin",
    password: process.env.ADMIN_PASS ?? "admin1234",
  });
  if (admin.status !== 200) throw new Error(`admin login ${admin.status}`);
  const adminToken = admin.json.token;
  const adminId = admin.json.user.id;

  startsAt = Date.now() + LEAD_SEC * 1000;
  const setup = await api("POST", "/api/admin/fresher", adminToken, {
    script: "fresher-v1",
    bots: process.env.BOTS ?? "passive",
    startsAt: new Date(startsAt).toISOString(),
  });
  if (setup.status >= 300)
    throw new Error(`setup ${setup.status} ${JSON.stringify(setup.json)} (reset the challenge first if it already ran)`);
  const cid = setup.json.id;
  console.log(`Fresher Sprint ${cid} opens at ${new Date(startsAt).toISOString()} (minute = ${MINUTE_MS} ms)`);

  const users = (await api("GET", "/api/admin/users", adminToken)).json
    .filter((u) => u.username.startsWith(PREFIX) && u.role === "trader")
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, 6);
  if (users.length < 6) throw new Error("need 6 test accounts (db:seed-loadtest)");
  await api("POST", `/api/admin/${cid}/enroll`, adminToken, { userIds: users.map((u) => u.id) });
  const [u1, u2, u3, u4, u5, u6] = users.map((u) => ({
    ...u,
    token: sign({ sub: u.id, username: u.username, role: "trader" }),
    alerts: [],
    rejections: [],
  }));
  const traders = [u1, u2, u3, u4, u5, u6];

  // Observer sockets: admin (sees everything) + each trader (private alerts).
  const log = { listed: new Map(), news: [], announcements: [], frozen: [], lbVisibility: [] };
  const open = (token, onMsg) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`${WS}/ws?token=${token}`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe", challengeId: cid }));
        resolve(ws);
      };
      ws.onmessage = (ev) => {
        try {
          onMsg(JSON.parse(ev.data));
        } catch {}
      };
    });
  await open(adminToken, (m) => {
    const t = gameSec();
    // AERIUM is in the opening config, so it is announced before the bell.
    if (m.type === "symbol_listed" && !log.listed.has(m.data.config.symbol))
      log.listed.set(m.data.config.symbol, Math.max(0, t));
    if (m.type === "news" && t > -1) {
      if (m.data.feed === "news") log.news.push({ t, ...m.data });
      else log.announcements.push({ t, message: m.data.message });
    }
    if (m.type === "market_status" && t > -1) log.frozen.push({ t, frozen: m.data.frozen });
    if (m.type === "leaderboard_visibility") log.lbVisibility.push({ t, hidden: m.data.hidden });
  });
  for (const u of traders)
    await open(u.token, (m) => {
      if (m.type === "alert") u.alerts.push({ t: gameSec(), message: m.data.message });
      if (m.type === "order" && m.data.status === "rejected")
        u.rejections.push({ t: gameSec(), reason: m.data.reason, symbol: m.data.symbol });
    });

  const order = (u, symbol, side, quantity, price = null) =>
    api("POST", "/api/orders", u.token, {
      challengeId: cid,
      symbol,
      side,
      type: price == null ? "market" : "limit",
      quantity,
      ...(price == null ? {} : { price }),
    });
  const bond = (u, price) =>
    api("POST", "/api/markets/bonds/purchase", u.token, {
      challengeId: cid,
      bondId: "fresher_bond",
      price,
    });

  // 00:30 — first trades and two rule checks.
  await waitGame(30);
  console.log(`[${clock()}] opening trades`);
  // No bots: players are the liquidity, so post a seller first.
  await order(u2, "AERIUM", "sell", 5, 1000);
  await sleep(300);
  check("market order accepted at the open", (await order(u1, "AERIUM", "buy", 5)).status === 202);
  const big = await order(u3, "AERIUM", "buy", 26);
  check("26-unit order is rejected, not trimmed", big.status === 400 && big.json?.error === "order_too_large", JSON.stringify(big.json));
  const early = await order(u4, "NEURO", "buy", 1, 750);
  check("NEURO cannot be traded before 05:00", early.status >= 400, JSON.stringify(early.json));

  // 10:30 — bond subscriptions.
  await waitGame(630);
  console.log(`[${clock()}] bond subscriptions`);
  check("bond: INR 10,000 subscription accepted", (await bond(u1, 10_000)).status === 202);
  const small = await bond(u2, 4_000);
  check("bond: below INR 5,000 is refused", small.json?.error === "principal_out_of_range", JSON.stringify(small.json));
  check("bond: INR 20,000 subscription accepted", (await bond(u3, 20_000)).status === 202);
  await sleep(500);
  const twice = await bond(u1, 5_000);
  check("bond: second subscription refused", twice.json?.error === "bond_limit", JSON.stringify(twice.json));

  // 20:10 — late bond, Market-X trade.
  await waitGame(1210);
  console.log(`[${clock()}] after the bond close`);
  const late = await bond(u4, 10_000);
  check("bond: subscription after 20:00 refused", late.json?.error === "bond_closed", JSON.stringify(late.json));
  await order(u2, "MARKETX", "sell", 5, 900);
  await sleep(300);
  check("Market-X is tradable after 20:00", (await order(u6, "MARKETX", "buy", 5, 900)).status === 202);

  // 25:05 — during the pause.
  await waitGame(1505);
  const paused = await order(u2, "AERIUM", "buy", 1);
  check("orders are rejected during the 25:00 pause", paused.status === 409 && paused.json?.error === "market_frozen", JSON.stringify(paused.json));

  // 26:00 — no leverage from short proceeds.
  await waitGame(1560);
  console.log(`[${clock()}] short then leveraged buy`);
  // Bids for the short to hit (no market makers).
  // Enough resting bids (150) for the full -100 short to fill.
  for (const u of [u2, u6]) for (let i = 0; i < 3; i++) await order(u, "AERIUM", "buy", 25, 990);
  await sleep(500);
  for (let i = 0; i < 4; i++) await order(u5, "AERIUM", "sell", 25);
  await sleep(1500);
  const short = (await api("GET", `/api/portfolio/${cid}`, u5.token)).json?.positions?.find((p) => p.symbol === "AERIUM")?.quantity;
  check("a -100 short is allowed", short === -100, `position ${short}`);
  await order(u5, "NEURO", "buy", 20);
  await sleep(1500);
  check(
    "short-sale proceeds cannot fund another position",
    u5.rejections.some((r) => r.reason === "exposure_limit" && r.symbol === "NEURO"),
    JSON.stringify(u5.rejections),
  );

  // Wait for settlement.
  console.log(`[${clock()}] waiting for the closing bell and settlement`);
  let final = null;
  const deadline = startsAt + 32 * MINUTE_MS + 60_000;
  while (Date.now() < deadline) {
    const c = (await api("GET", `/api/challenges/${cid}`, adminToken)).json;
    if (c?.status === "ended") {
      const rows = (await api("GET", `/api/leaderboard/${cid}`, adminToken)).json;
      // Final standings carry settlement; live rows do not.
      if (Array.isArray(rows) && rows.length && rows.every((r) => r.settlement != null)) {
        final = rows;
        break;
      }
    }
    await sleep(2000);
  }

  // ---- Checklist ----
  console.log("\n=== Schedule ===");
  const near = (t, want, tol = 3) => t != null && Math.abs(t - want) <= tol * (60_000 / MINUTE_MS) + 2;
  for (const [sym, want] of [["AERIUM", 0], ["NEURO", 300], ["SOLAR", 600], ["ORBIT", 900], ["MARKETX", 1200]])
    check(`${sym} listed at ${clock(want)}`, sym === "AERIUM" ? log.listed.has(sym) : near(log.listed.get(sym), want), `seen ${log.listed.has(sym) ? clock(log.listed.get(sym)) : "never"}`);
  check("29 headlines released", log.news.length === 29, `${log.news.length}`);
  check("every headline names its instrument", log.news.every((n) => Array.isArray(n.symbols) && n.symbols.length > 0));
  check("headline classification is never sent to traders", log.news.every((n) => !("kind" in n)));
  // Only state changes count; a repeat of the current state is harmless.
  const lbChanges = log.lbVisibility
    .filter((v) => v.t > -1)
    .filter((v, i, all) => i === 0 || v.hidden !== all[i - 1].hidden);
  const [lbHide, lbShow, lbHideFinal] = lbChanges;
  check("rankings hidden at 00:00, shown at 05:00, hidden at 25:00",
    lbHide?.hidden === true && near(lbHide.t, 0) &&
      lbShow?.hidden === false && near(lbShow.t, 300) &&
      lbHideFinal?.hidden === true && near(lbHideFinal.t, 1500),
    JSON.stringify(log.lbVisibility.map((v) => `${clock(v.t)} ${v.hidden ? "hide" : "show"}`)));
  const reveal = log.lbVisibility.at(-1);
  check("final rankings revealed after settlement", reveal && !reveal.hidden && reveal.t >= 1795, reveal ? `${clock(reveal.t)} ${reveal.hidden ? "hide" : "show"}` : "none");
  const pause = log.frozen.find((f) => f.frozen && f.t > 1400 && f.t < 1700);
  const resume = log.frozen.find((f) => !f.frozen && f.t > 1500 && f.t < 1700);
  check("15-second pause at 25:00", pause && resume && near(pause.t, 1500) && near(resume.t, 1515),
    `${pause ? clock(pause.t) : "-"} -> ${resume ? clock(resume.t) : "-"}`);
  check("announcements for listings, bond and final phase", log.announcements.length >= 7, `${log.announcements.length}`);

  console.log("\n=== Bond ===");
  const coupons = (u) => u.alerts.filter((a) => a.message.startsWith("Coupon")).length;
  const matured = (u) => u.alerts.some((a) => a.message.includes("matured"));
  check("10:30 buyer receives all 7 coupons", coupons(u1) === 7, `${coupons(u1)}`);
  check("principal returned at maturity", matured(u1) && matured(u3));
  check("non-subscriber receives no coupons", coupons(u2) === 0);

  console.log("\n=== Settlement ===");
  check("final results published", Array.isArray(final) && final.length >= 6, final ? `${final.length} rows` : "none");
  if (final) {
    const row = (u) => final.find((r) => r.userId === u.id);
    check("every row has a final net worth", final.every((r) => Number.isFinite(r.netWorth)));
    const r1 = row(u1);
    // u1: bond 10,000 at 1.5x adds 5,000; plus small AERIUM trading PnL.
    check("bond buyer's net worth includes 5,000 interest", r1 && r1.netWorth > 100_000 + 4_000, r1 ? r1.netWorth.toFixed(2) : "-");
    check("non-trader ends at starting cash", Math.abs((row(u4)?.netWorth ?? 0) - 100_000) < 1e-6, `${row(u4)?.netWorth}`);
    check("ranks ordered by net worth", final.every((r, i) => i === 0 || final[i - 1].netWorth >= r.netWorth));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
