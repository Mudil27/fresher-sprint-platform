#!/usr/bin/env node
/**
 * Realistic event load test: N distinct traders, each with its own WebSocket,
 * order flow and (optionally) browser-like REST polling. Traders are spread
 * over WORKERS child processes so the generator itself does not become the
 * bottleneck. Run it from a different machine than the event host.
 *
 * Measures:
 *   - order POST latency (API accept)
 *   - end-to-end latency: POST -> the trader's private `order` WS message,
 *     which the engine emits only after matching and persisting the order
 *   - WS bytes / messages per second, per message type
 *   - REST polling latency, errors, socket drops
 *
 * Requires Node 22+ (global WebSocket + fetch). No dependencies.
 *
 * Env:
 *   API_URL / WS_URL     default http://localhost / ws://localhost
 *   CHALLENGE_ID         existing LIVE challenge; omit to create one (needs admin)
 *   ADMIN_USER/ADMIN_PASS  default admin / admin1234 (create + enroll)
 *   USERS                traders to simulate (default 400)
 *   USER_PREFIX          default "lt"  (accounts from db:seed-loadtest)
 *   PASSWORD             default loadtest1234
 *   JWT_SECRET           if set, tokens are signed locally instead of logging in
 *   LOGIN_CONCURRENCY    parallel logins when not signing locally (default 20)
 *   WORKERS              child processes (default 8)
 *   DURATION             seconds of trading (default 60)
 *   ORDER_RATE           mean orders/sec per trader (default 0.3)
 *   OPEN_BURST           orders each trader fires in the first 3 s (default 2)
 *   POLL                 app    = the trader screen's REST use with its socket open
 *                                 (default: challenge + open orders every 30 s, and
 *                                 two open-order reads after each own order)
 *                        legacy = the pre-Fresher screen's fast polling
 *                        0      = no REST besides orders
 *   POLL_SCALE           multiply polling intervals (default 1)
 *   SYMBOLS              symbols for a created challenge (default 5)
 *   KEEP                 1 = leave a created challenge live afterwards
 */
import { fork } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

const API = process.env.API_URL ?? "http://localhost";
const WS = process.env.WS_URL ?? "ws://localhost";
const DURATION = Number(process.env.DURATION ?? 60);
const ORDER_RATE = Number(process.env.ORDER_RATE ?? 0.3);
const OPEN_BURST = Number(process.env.OPEN_BURST ?? 2);
const POLL = process.env.POLL === "0" ? "" : (process.env.POLL ?? "app");
const POLL_SCALE = Number(process.env.POLL_SCALE ?? 1);

const NAMES = ["AERIUM", "NEURO", "SOLAR", "ORBIT", "MARKETX", "LT6", "LT7"];
const PRICES = [1000, 750, 800, 600, 850, 500, 400];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (arr) =>
  `p50=${pct(arr, 50)} p95=${pct(arr, 95)} p99=${pct(arr, 99)} max=${arr.length ? arr.reduce((a, b) => Math.max(a, b), 0) : 0} (n=${arr.length})`;

async function api(method, path, { token, body } = {}) {
  const t0 = Date.now();
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
  return { status: res.status, json, ms: Date.now() - t0 };
}

/* ------------------------------ worker ------------------------------ */

async function worker({ challengeId, tokens, symbols, startAt }) {
  const stats = {
    postLatency: [],
    e2eLatency: [],
    restLatency: [],
    ordersSent: 0,
    orderCodes: {},
    restErr: 0,
    wsOpen: 0,
    wsDrops: 0,
    wsErrors: 0,
    bytes: 0,
    msgs: 0,
    byType: {},
    bytesByType: {},
    lbMaxBytes: 0,
    unacked: 0,
  };
  const mids = new Map();
  const pending = new Map();
  let running = true;
  const typeRe = /^\{"type":"([a-z_]+)"/;

  const sockets = tokens.map((token) => {
    const ws = new WebSocket(`${WS}/ws?token=${token}`);
    ws.onopen = () => {
      stats.wsOpen++;
      ws.send(JSON.stringify({ type: "subscribe", challengeId }));
    };
    ws.onmessage = (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : "";
      stats.bytes += raw.length;
      stats.msgs++;
      const type = typeRe.exec(raw)?.[1] ?? "?";
      stats.byType[type] = (stats.byType[type] ?? 0) + 1;
      stats.bytesByType[type] = (stats.bytesByType[type] ?? 0) + raw.length;
      if (type === "leaderboard")
        stats.lbMaxBytes = Math.max(stats.lbMaxBytes, raw.length);
      if (type === "order") {
        const id = /"orderId":"([^"]+)"/.exec(raw)?.[1];
        const sent = id ? pending.get(id) : undefined;
        if (sent != null) {
          stats.e2eLatency.push(Date.now() - sent);
          pending.delete(id);
        }
      } else if (type === "price") {
        try {
          const m = JSON.parse(raw);
          mids.set(m.data.symbol, m.data.price);
        } catch {}
      }
    };
    ws.onerror = () => stats.wsErrors++;
    ws.onclose = () => {
      if (running) stats.wsDrops++;
    };
    return ws;
  });

  await sleep(Math.max(0, startAt - Date.now()));
  const tEnd = Date.now() + DURATION * 1000;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const myOpen = tokens.map(() => []);

  async function placeOne(i) {
    const token = tokens[i];
    const symbol = pick(symbols);
    const mid = mids.get(symbol) ?? PRICES[NAMES.indexOf(symbol)] ?? 1000;
    const side = Math.random() < 0.5 ? "buy" : "sell";
    const r = Math.random();
    if (r < 0.2 && myOpen[i].length) {
      const id = myOpen[i].shift();
      const res = await api("DELETE", `/api/orders/${id}`, { token });
      const key = `cancel:${res.status}`;
      stats.orderCodes[key] = (stats.orderCodes[key] ?? 0) + 1;
      return;
    }
    const market = r < 0.45;
    const off =
      (Math.floor(Math.random() * 6) + 1) * 0.5 * (side === "buy" ? -1 : 1);
    const body = {
      challengeId,
      symbol,
      side,
      type: market ? "market" : "limit",
      quantity: 1 + Math.floor(Math.random() * 8),
      ...(market
        ? {}
        : { price: Math.max(0.5, Math.round((mid + off) * 2) / 2) }),
    };
    stats.ordersSent++;
    const sentAt = Date.now();
    const res = await api("POST", "/api/orders", { token, body });
    stats.postLatency.push(res.ms);
    const key = `${res.status}${res.json?.error ? ":" + res.json.error : ""}`;
    stats.orderCodes[key] = (stats.orderCodes[key] ?? 0) + 1;
    if (POLL === "app") {
      // The order list and the ticket each reload open orders on an order event.
      for (let k = 0; k < 2; k++)
        api("GET", `/api/orders?challengeId=${challengeId}&open=true`, {
          token,
        })
          .then((r) => stats.restLatency.push(r.ms))
          .catch(() => stats.restErr++);
    }
    if (res.status === 202 && res.json?.orderId) {
      pending.set(res.json.orderId, sentAt);
      if (!market) {
        myOpen[i].push(res.json.orderId);
        if (myOpen[i].length > 8) myOpen[i].shift();
      }
    }
  }

  const loops = tokens.map(async (_, i) => {
    for (let b = 0; b < OPEN_BURST; b++) {
      await sleep(Math.random() * 3000);
      placeOne(i).catch(() => stats.restErr++);
    }
    while (Date.now() < tEnd) {
      await sleep(-Math.log(1 - Math.random()) * (1000 / ORDER_RATE));
      if (Date.now() >= tEnd) break;
      placeOne(i).catch(() => stats.restErr++);
    }
  });

  const pollers = [];
  if (POLL) {
    const every = (baseMs, fn) =>
      tokens.map(async (token) => {
        const ms = baseMs * POLL_SCALE;
        await sleep(Math.random() * ms);
        while (Date.now() < tEnd) {
          const t = Date.now();
          try {
            const res = await fn(token);
            stats.restLatency.push(res.ms);
            if (res.status >= 400 && res.status !== 403) stats.restErr++;
          } catch {
            stats.restErr++;
          }
          await sleep(Math.max(0, ms - (Date.now() - t)));
        }
      });
    if (POLL === "app")
      pollers.push(
        ...every(30_000, (token) =>
          api("GET", `/api/challenges/${challengeId}`, { token }),
        ),
        ...every(30_000, (token) =>
          api("GET", `/api/orders?challengeId=${challengeId}&open=true`, {
            token,
          }),
        ),
      );
    else
      pollers.push(
        ...every(5000, (token) =>
          api("GET", `/api/challenges/${challengeId}`, { token }),
        ),
        ...every(3000, (token) =>
          api("GET", `/api/market/${challengeId}/${pick(symbols)}/orderbook`, {
            token,
          }),
        ),
        ...every(4000, (token) =>
          api("GET", `/api/orders?challengeId=${challengeId}&open=true`, {
            token,
          }),
        ),
        ...every(3000, (token) =>
          api("GET", `/api/portfolio/${challengeId}`, { token }),
        ),
      );
  }

  // Progress for the coordinator every 5 s.
  const progress = setInterval(() => {
    process.send?.({
      kind: "progress",
      orders: stats.ordersSent,
      pending: pending.size,
      bytes: stats.bytes,
      msgs: stats.msgs,
      drops: stats.wsDrops,
    });
  }, 5000);

  await Promise.all(loops);
  await sleep(5000);
  running = false;
  clearInterval(progress);
  await Promise.race([Promise.all(pollers), sleep(6000)]);
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {}
  }
  stats.unacked = pending.size;
  process.send?.({ kind: "done", stats });
}

/* ---------------------------- coordinator --------------------------- */

function signJwt(secret, payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ ...payload, iat: now, exp: now + 6 * 3600 });
  const sig = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function createChallenge(adminToken, nSymbols) {
  const symbols = NAMES.slice(0, nSymbols).map((symbol, i) => ({
    symbol,
    initialPrice: PRICES[i],
    volatility: 0,
    tickSize: 0.5,
  }));
  const config = {
    symbols,
    startingCash: 100000,
    minPosition: -100,
    maxPosition: 100,
    maxOrderQuantity: 25,
    maxOpenOrders: 10,
    maxOrdersPerSecond: 5,
    maxVolumePerMinute: 1000,
    allowMargin: false,
    strictRisk: true,
    autonomousPrice: true,
    eden: {
      rules: {
        enabled: true,
        costOfCarryPerUnitPerMinute: 0,
        loanRepayMultiplier: 2,
        marginCallThreshold: -1e12,
        forcedLiquidation: false,
        positionCap: 100,
      },
      bots: {
        hftMarketMakers: 0,
        momentumTraders: 0,
        vegaSnipers: 0,
        parityArbers: 0,
        spread: 1,
        quoteSize: 10,
        intensity: 0.6,
      },
      options: {
        enabled: false,
        underlyings: [],
        cycleMinutes: 5,
        exerciseWindowSec: 15,
        autoCycle: false,
        strikeSteps: 1,
      },
      bonds: [],
      etfs: [],
    },
  };
  const created = await api("POST", "/api/challenges", {
    token: adminToken,
    body: {
      name: `Load test ${new Date().toISOString()}`,
      type: "new_eden",
      config,
    },
  });
  if (created.status !== 201)
    throw new Error(
      `create failed ${created.status} ${JSON.stringify(created.json)}`,
    );
  const live = await api("POST", `/api/challenges/${created.json.id}/status`, {
    token: adminToken,
    body: { status: "live" },
  });
  if (live.status !== 200) throw new Error(`go live failed ${live.status}`);
  return created.json.id;
}

async function coordinator() {
  const USERS = Number(process.env.USERS ?? 400);
  const PREFIX = process.env.USER_PREFIX ?? "lt";
  const PASSWORD = process.env.PASSWORD ?? "loadtest1234";
  const WORKERS = Math.max(1, Number(process.env.WORKERS ?? 8));
  let challengeId = process.env.CHALLENGE_ID;
  const created = !challengeId;
  console.log(
    `Fresher load test -> ${API} | ${WS}\n  users=${USERS} workers=${WORKERS} duration=${DURATION}s orderRate=${ORDER_RATE}/s/user openBurst=${OPEN_BURST} poll=${POLL ? `${POLL} x${POLL_SCALE}` : "off"}`,
  );

  const admin = await api("POST", "/api/auth/login", {
    body: {
      username: process.env.ADMIN_USER ?? "admin",
      password: process.env.ADMIN_PASS ?? "admin1234",
    },
  });
  if (admin.status !== 200)
    throw new Error(`admin login failed ${admin.status}`);
  const adminToken = admin.json.token;
  if (!challengeId)
    challengeId = await createChallenge(
      adminToken,
      Number(process.env.SYMBOLS ?? 5),
    );
  console.log(`  challenge ${challengeId}`);

  const users = (
    await api("GET", "/api/admin/users", { token: adminToken })
  ).json
    .filter((u) => u.username.startsWith(PREFIX) && u.role === "trader")
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, USERS);
  if (users.length < USERS)
    console.warn(`  ! only ${users.length} ${PREFIX}* accounts exist`);
  for (let i = 0; i < users.length; i += 500) {
    const res = await api("POST", `/api/admin/${challengeId}/enroll`, {
      token: adminToken,
      body: { userIds: users.slice(i, i + 500).map((u) => u.id) },
    });
    if (res.status >= 300)
      console.warn(`  ! enroll ${res.status} ${JSON.stringify(res.json)}`);
  }

  const t0 = Date.now();
  const tokens = [];
  if (process.env.JWT_SECRET) {
    for (const u of users)
      tokens.push(
        signJwt(process.env.JWT_SECRET, {
          sub: u.id,
          username: u.username,
          role: "trader",
        }),
      );
  } else {
    let next = 0;
    const failures = {};
    await Promise.all(
      Array.from(
        { length: Number(process.env.LOGIN_CONCURRENCY ?? 20) },
        async () => {
          while (next < users.length) {
            const u = users[next++];
            const r = await api("POST", "/api/auth/login", {
              body: { username: u.username, password: PASSWORD },
            });
            if (r.status === 200) tokens.push(r.json.token);
            else failures[r.status] = (failures[r.status] ?? 0) + 1;
          }
        },
      ),
    );
    if (Object.keys(failures).length)
      console.warn("  ! login failures", failures);
  }
  console.log(
    `  ${tokens.length} tokens in ${Date.now() - t0} ms (${process.env.JWT_SECRET ? "signed locally" : "via /login"})`,
  );

  const symbols = (
    await api("GET", `/api/market/${challengeId}/symbols`)
  ).json.map((s) => s.symbol ?? s);
  const startAt = Date.now() + 4000; // let every worker connect first
  const self = fileURLToPath(import.meta.url);
  const per = Math.ceil(tokens.length / WORKERS);
  const progress = new Map();
  const reporter = setInterval(() => {
    let orders = 0,
      pending = 0,
      bytes = 0,
      msgs = 0,
      drops = 0;
    for (const p of progress.values()) {
      orders += p.orders;
      pending += p.pending;
      bytes += p.bytes;
      msgs += p.msgs;
      drops += p.drops;
    }
    console.log(
      `[t=${((Date.now() - startAt) / 1000).toFixed(0)}s] orders=${orders} awaitingFill=${pending} wsBytes=${(bytes / 1e6).toFixed(1)}MB msgs=${msgs} drops=${drops}`,
    );
  }, 5000);

  const results = await Promise.all(
    Array.from({ length: WORKERS }, (_, w) => {
      const slice = tokens.slice(w * per, (w + 1) * per);
      if (slice.length === 0) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const child = fork(self, ["--worker"], { env: process.env });
        child.on("message", (m) => {
          if (m.kind === "progress") progress.set(w, m);
          if (m.kind === "done") resolve(m.stats);
        });
        child.on("error", reject);
        child.on(
          "exit",
          (code) =>
            code !== 0 && reject(new Error(`worker ${w} exited ${code}`)),
        );
        child.send({ challengeId, tokens: slice, symbols, startAt });
      });
    }),
  ).finally(() => clearInterval(reporter));

  if (created && process.env.KEEP !== "1")
    await api("POST", `/api/challenges/${challengeId}/status`, {
      token: adminToken,
      body: { status: "ended" },
    });

  // Merge worker stats.
  const all = results.filter(Boolean);
  const merged = {
    postLatency: all.flatMap((s) => s.postLatency),
    e2eLatency: all.flatMap((s) => s.e2eLatency),
    restLatency: all.flatMap((s) => s.restLatency),
  };
  const sum = (k) => all.reduce((a, s) => a + s[k], 0);
  const codes = {};
  const byType = {};
  const bytesByType = {};
  for (const s of all) {
    for (const [k, v] of Object.entries(s.orderCodes))
      codes[k] = (codes[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.byType))
      byType[k] = (byType[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.bytesByType))
      bytesByType[k] = (bytesByType[k] ?? 0) + v;
  }
  const secs = DURATION + 5;
  const wsOpen = sum("wsOpen");
  console.log("\n=== RESULTS ===");
  console.log(`order POST latency ms     ${fmt(merged.postLatency)}`);
  console.log(`order -> WS ack (e2e) ms  ${fmt(merged.e2eLatency)}`);
  console.log(`orders never acked        ${sum("unacked")}`);
  console.log(
    `REST poll latency ms      ${fmt(merged.restLatency)}  errors=${sum("restErr")}`,
  );
  console.log(`order responses           ${JSON.stringify(codes)}`);
  console.log(
    `order throughput          ${(sum("ordersSent") / DURATION).toFixed(1)}/s`,
  );
  console.log(
    `ws open/drops/errors      ${wsOpen}/${sum("wsDrops")}/${sum("wsErrors")}`,
  );
  console.log(
    `ws total                  ${(sum("bytes") / secs / 1e6).toFixed(2)} MB/s, ${(sum("msgs") / secs).toFixed(0)} msg/s, per client ${(sum("bytes") / secs / Math.max(1, wsOpen) / 1e3).toFixed(1)} KB/s`,
  );
  console.log(
    `largest leaderboard msg   ${(Math.max(0, ...all.map((s) => s.lbMaxBytes)) / 1e3).toFixed(1)} KB`,
  );
  for (const t of Object.keys(byType).sort(
    (a, b) => bytesByType[b] - bytesByType[a],
  ))
    console.log(
      `  ${t.padEnd(22)} ${String(byType[t]).padStart(8)} msgs ${(bytesByType[t] / 1e6).toFixed(1).padStart(8)} MB`,
    );
  process.exit(0);
}

if (process.argv.includes("--worker")) {
  process.once("message", (job) =>
    worker(job)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      }),
  );
} else {
  coordinator().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
