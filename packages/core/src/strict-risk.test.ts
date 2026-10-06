import { describe, expect, it } from "vitest";
import { ChallengeEngine, type EngineConfig } from "./engine.js";
import type { EngineEvent, OrderUpdateEvent } from "@qtp/shared";

const ALICE = "00000000-0000-4000-a000-0000000000a1";
const BOB = "00000000-0000-4000-a000-0000000000b2";
let n = 0;

function makeEngine(overrides: Partial<EngineConfig> = {}) {
  return new ChallengeEngine({
    challengeId: "c1",
    symbols: [
      { symbol: "A", initialPrice: 1000, volatility: 0, tickSize: 0.5 },
      { symbol: "B", initialPrice: 500, volatility: 0, tickSize: 0.5 },
    ],
    startingCash: 100_000,
    minPosition: -100,
    maxPosition: 100,
    maxOrderQuantity: 25,
    maxOpenOrders: 10,
    allowMargin: false,
    strictRisk: true,
    ...overrides,
  });
}

function order(
  engine: ChallengeEngine,
  userId: string,
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number | null,
): EngineEvent[] {
  return engine.placeOrder({
    orderId: `o${++n}`,
    userId,
    symbol,
    side,
    orderType: price == null ? "market" : "limit",
    quantity,
    price,
    ts: 1,
  });
}

const own = (events: EngineEvent[], userId: string) =>
  events.filter(
    (e): e is OrderUpdateEvent =>
      e.type === "order_update" && e.userId === userId,
  );
const last = (events: EngineEvent[], userId: string) =>
  own(events, userId).at(-1);

/** Liquidity from a bot so humans can fill. */
function quote(
  engine: ChallengeEngine,
  symbol: string,
  bid: number,
  ask: number,
) {
  for (const [side, price] of [
    ["buy", bid],
    ["sell", ask],
  ] as const)
    engine.placeOrder({
      orderId: `bot${++n}`,
      userId: "bot:mm",
      symbol,
      side,
      orderType: "limit",
      quantity: 10_000,
      price,
      ts: 0,
    });
}

describe("strict risk", () => {
  it("rejects an order above the size limit instead of trimming it", () => {
    const e = makeEngine();
    quote(e, "A", 999, 1001);
    const res = last(order(e, ALICE, "A", "buy", 26, null), ALICE);
    expect(res).toMatchObject({
      status: "rejected",
      reason: "order_too_large",
    });
    expect(e.positionOf(ALICE, "A")).toBe(0);
  });

  it("rejects prices off the tick grid", () => {
    const e = makeEngine();
    expect(last(order(e, ALICE, "A", "buy", 1, 999.3), ALICE)).toMatchObject({
      status: "rejected",
      reason: "invalid_price",
    });
  });

  it("counts working orders toward the position limit", () => {
    const e = makeEngine({ startingCash: 1_000_000 });
    for (let i = 0; i < 4; i++) order(e, ALICE, "B", "buy", 25, 400);
    // 100 working buys: one more unit breaks +100.
    expect(last(order(e, ALICE, "B", "buy", 1, 400), ALICE)).toMatchObject({
      reason: "position_limit",
    });
    // Short side is limited the same way.
    for (let i = 0; i < 4; i++) order(e, BOB, "B", "sell", 25, 600);
    expect(last(order(e, BOB, "B", "sell", 1, 600), BOB)).toMatchObject({
      reason: "position_limit",
    });
  });

  it("holds cash for resting buys so two bids cannot spend the same rupees", () => {
    const e = makeEngine({ startingCash: 30_000 });
    expect(last(order(e, ALICE, "A", "buy", 20, 900), ALICE)?.status).toBe(
      "open",
    );
    // 18,000 is held; 12,000 is free, so a 15-lot at 900 (13,500) is refused.
    expect(last(order(e, ALICE, "A", "buy", 15, 900), ALICE)).toMatchObject({
      reason: "insufficient_cash",
    });
    // 10 more fits both rules: 9,000 cash, and 30 lots x mark 1,000 = equity.
    expect(last(order(e, ALICE, "A", "buy", 10, 900), ALICE)?.status).toBe(
      "open",
    );
  });

  it("prices market buys from the book when checking cash", () => {
    const e = makeEngine({ startingCash: 10_000 });
    quote(e, "A", 999, 1001);
    expect(last(order(e, ALICE, "A", "buy", 10, null), ALICE)).toMatchObject({
      reason: "insufficient_cash",
    });
    expect(last(order(e, ALICE, "A", "buy", 9, null), ALICE)?.status).toBe(
      "filled",
    );
    expect(e.cashOf(ALICE)).toBeCloseTo(10_000 - 9 * 1001);
  });

  it("does not let short-sale proceeds lever up another position", () => {
    const e = makeEngine();
    quote(e, "A", 1000, 1000.5);
    quote(e, "B", 500, 500.5);
    for (let i = 0; i < 4; i++) order(e, ALICE, "A", "sell", 25, null);
    expect(e.positionOf(ALICE, "A")).toBe(-100);
    expect(e.cashOf(ALICE)).toBeCloseTo(200_000);
    // Exposure is already ~100k against ~100k equity: buying B adds exposure.
    expect(last(order(e, ALICE, "B", "buy", 10, null), ALICE)).toMatchObject({
      reason: "exposure_limit",
    });
    // Covering reduces exposure and is always allowed.
    expect(last(order(e, ALICE, "A", "buy", 10, null), ALICE)?.status).toBe(
      "filled",
    );
  });

  it("allows risk-reducing orders even when exposure exceeds equity", () => {
    const e = makeEngine();
    quote(e, "A", 1000, 1000.5);
    for (let i = 0; i < 4; i++) order(e, ALICE, "A", "sell", 25, null);
    // Price rallies hard: the short is now worth more than equity.
    e.setPrice("A", 1200);
    expect(e.exposureOf(ALICE)).toBeGreaterThan(e.liquidEquityOf(ALICE));
    // Adding to the short is refused, buying back is not.
    e.setPrice("A", 1200);
    quote(e, "A", 1199.5, 1200.5);
    expect(last(order(e, ALICE, "A", "sell", 1, 1300), ALICE)).toMatchObject({
      reason: "position_limit",
    });
    expect(last(order(e, ALICE, "A", "buy", 5, 1250), ALICE)?.status).toBe(
      "filled",
    );
  });

  it("cancels a trader's own resting order instead of trading with it", () => {
    const e = makeEngine();
    order(e, ALICE, "A", "sell", 5, 1000);
    const events = order(e, ALICE, "A", "buy", 5, 1000);
    expect(events.some((x) => x.type === "trade")).toBe(false);
    expect(own(events, ALICE).map((u) => u.status)).toEqual([
      "cancelled",
      "open",
    ]);
    expect(e.positionOf(ALICE, "A")).toBe(0);
  });

  it("caps open orders at the configured limit", () => {
    const e = makeEngine();
    for (let i = 0; i < 10; i++) order(e, ALICE, "B", "buy", 1, 400);
    expect(last(order(e, ALICE, "B", "buy", 1, 400), ALICE)).toMatchObject({
      reason: "too_many_open_orders",
    });
  });

  it("refuses a cash withdrawal that would break exposure", () => {
    const e = makeEngine();
    quote(e, "A", 1000, 1000.5);
    for (let i = 0; i < 4; i++) order(e, ALICE, "A", "sell", 25, null);
    expect(e.cashWithdrawalRejection(ALICE, 5_000)).toBe("exposure_limit");
    expect(e.cashWithdrawalRejection(BOB, 5_000)).toBeNull();
    expect(e.cashWithdrawalRejection(BOB, 150_000)).toBe("insufficient_cash");
  });

  it("leaves legacy clamping untouched without strictRisk", () => {
    const e = makeEngine({ strictRisk: false, allowMargin: true });
    quote(e, "A", 999, 1001);
    const res = last(order(e, ALICE, "A", "buy", 40, null), ALICE);
    expect(res?.status).toBe("filled");
    expect(res?.quantity).toBe(25);
  });
});

describe("strict final marks", () => {
  it("marks at the midpoint, else the one-sided best bid or ask", () => {
    const e = makeEngine();
    quote(e, "A", 990, 1010);
    order(e, BOB, "B", "buy", 1, 480);
    e.markBooksToMid();
    expect(e.getPrice("A")).toBe(1000);
    expect(e.getPrice("B")).toBe(480);
  });

  it("marks an empty book at the last actual trade, not the blended mark", () => {
    const e = makeEngine();
    order(e, BOB, "A", "sell", 1, 1100);
    order(e, ALICE, "A", "buy", 1, 1100);
    // The live mark only moves 90% of the way toward a print.
    expect(e.getPrice("A")).not.toBe(1100);
    e.markBooksToMid();
    expect(e.getPrice("A")).toBe(1100);
  });

  it("falls back to fair value, then the listing price, when never traded", () => {
    const e = makeEngine();
    e.setFairValue("A", 1040);
    e.markBooksToMid();
    expect(e.getPrice("A")).toBe(1040);
    expect(e.getPrice("B")).toBe(500);
  });

  it("keeps the last trade across a checkpoint restore", () => {
    const e = makeEngine();
    order(e, BOB, "A", "sell", 1, 1100);
    order(e, ALICE, "A", "buy", 1, 1100);
    const restored = makeEngine();
    restored.restoreState(e.exportState());
    restored.markBooksToMid();
    expect(restored.getPrice("A")).toBe(1100);
  });
});
