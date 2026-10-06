import { describe, expect, it } from "vitest";
import {
  FRESHER_ACTIONS,
  FRESHER_CUES,
  FRESHER_HEADLINES,
  FRESHER_INSTRUMENTS,
  WARMUP_ACTIONS,
  WARMUP_CUES,
  bondCouponAmount,
  fresherBondTemplate,
  fresherPhaseAt,
  type EdenEventAction,
} from "@qtp/shared";

const at = (second: number) =>
  FRESHER_ACTIONS.filter((a) => a.atSecond === second).map((a) =>
    a.kind === "news"
      ? `news/${a.news.minute}`
      : a.kind === "list_underlying" || a.kind === "list_etf"
        ? `list/${a.config.symbol}`
        : a.kind === "bond_coupon"
          ? a.maturity
            ? "maturity"
            : `coupon/${a.index + 1}`
          : a.kind === "leaderboard_visibility"
            ? a.hidden
              ? "rankings/hide"
              : "rankings/show"
            : a.kind,
  );

describe("fresher-v1 schedule", () => {
  it("releases exactly one public headline per minute 1-29, never early", () => {
    const news = FRESHER_ACTIONS.filter(
      (a): a is Extract<EdenEventAction, { kind: "news" }> => a.kind === "news",
    );
    expect(news.map((n) => n.news.minute)).toEqual(
      Array.from({ length: 29 }, (_, i) => i + 1),
    );
    for (const n of news) {
      expect(n.audience).toBe("public");
      expect(n.atSecond).toBe(n.news.minute * 60);
      expect(n.news.leadSec).toBe(0);
    }
  });

  it("never names or moves an instrument before it is listed", () => {
    const listedAt = new Map<string, number>();
    for (const a of FRESHER_ACTIONS) {
      if (a.kind === "market_open" && a.symbol)
        listedAt.set(a.symbol.symbol, a.atSecond);
      if (a.kind === "list_underlying")
        listedAt.set(a.config.symbol, a.atSecond);
      if (a.kind === "list_etf") listedAt.set(a.config.symbol, a.atSecond);
      if (a.kind !== "news") continue;
      const symbols = [
        ...(a.news.targets ?? []),
        ...a.news.effects.map((e) => e.symbol),
        ...a.news.momentum.map((m) => m.symbol),
      ];
      expect(symbols.length).toBeGreaterThan(0);
      for (const s of symbols) {
        // Listed by an action that ran before this one (same second counts).
        expect(listedAt.has(s), `${s} at minute ${a.news.minute}`).toBe(true);
      }
    }
  });

  it("lists every instrument at its minute, before that minute's headline", () => {
    for (const inst of FRESHER_INSTRUMENTS) {
      const second = inst.listMinute * 60;
      const order = at(second);
      if (inst.listMinute === 0) {
        expect(order[0]).toBe("market_open");
        continue;
      }
      const list = order.indexOf(`list/${inst.symbol}`);
      expect(list).toBeGreaterThanOrEqual(0);
      expect(list).toBeLessThan(order.indexOf(`news/${inst.listMinute}`));
    }
  });

  it("orders 20:00 as coupon, close, Market-X listing, headline", () => {
    const order = at(1200).filter((x) =>
      ["coupon/4", "bond_close", "list/MARKETX", "news/20"].includes(x),
    );
    expect(order).toEqual([
      "coupon/4",
      "bond_close",
      "list/MARKETX",
      "news/20",
    ]);
  });

  it("orders 25:00 as pause, headline, coupon, hide rankings; resumes 15 s later", () => {
    const order = at(1500).filter((x) =>
      ["freeze", "news/25", "coupon/6", "rankings/hide"].includes(x),
    );
    expect(order).toEqual(["freeze", "news/25", "coupon/6", "rankings/hide"]);
    expect(at(1515)).toEqual(["unfreeze"]);
    const pause = FRESHER_ACTIONS.find((a) => a.kind === "freeze");
    expect(pause).toMatchObject({ reason: "pause" });
  });

  it("pays maturity before the closing bell", () => {
    expect(at(1800)).toEqual(["maturity", "end"]);
  });

  it("hides rankings 0-5 and 25-30 and shows them in between", () => {
    expect(at(0)).toContain("rankings/hide");
    expect(at(300)).toContain("rankings/show");
    expect(at(1500)).toContain("rankings/hide");
  });

  it("keeps the 14 / 10 / 5 headline mix and no direct Market-X shocks", () => {
    const count = (c: string) =>
      FRESHER_HEADLINES.filter((h) => h.category === c).length;
    expect([count("signal"), count("noise"), count("market-wide")]).toEqual([
      14, 10, 5,
    ]);
    for (const h of FRESHER_HEADLINES) {
      expect(Object.keys(h.fv)).not.toContain("MARKETX");
      expect(Object.keys(h.momentum)).not.toContain("MARKETX");
      expect(h.targets).not.toContain("MARKETX");
      if (h.category === "noise") expect(h.fv).toEqual({});
    }
  });

  it("pays 7 equal coupons summing to 50% of principal at 1.5x", () => {
    const schedule = fresherBondTemplate().schedule!;
    expect(schedule.couponSeconds).toEqual([
      750, 900, 1050, 1200, 1350, 1500, 1650,
    ]);
    expect(bondCouponAmount(schedule, 10_000)).toBeCloseTo(714.2857, 3);
    expect(bondCouponAmount(schedule, 10_000) * 7).toBeCloseTo(5_000, 6);
    // A buyer just after 20:00 misses coupons 1-4 and gets 3.
    expect(bondCouponAmount(schedule, 10_000) * 3).toBeCloseTo(2_142.857, 2);
  });

  it("reports the public phase for the trader screen", () => {
    expect(fresherPhaseAt("fresher-v1", 299)).toMatchObject({
      listed: ["AERIUM"],
      nextListing: { symbol: "NEURO", atSecond: 300 },
      leaderboardVisible: false,
    });
    expect(fresherPhaseAt("fresher-v1", 1505)).toMatchObject({
      paused: true,
      finalPhase: true,
      leaderboardVisible: false,
      bondOpen: false,
    });
    expect(fresherPhaseAt("fresher-v1", 1800)).toMatchObject({
      ended: true,
      remainingSec: 0,
    });
  });

  it("generates a sequential cue sheet covering every action exactly once", () => {
    for (const [cues, actions] of [
      [FRESHER_CUES, FRESHER_ACTIONS],
      [WARMUP_CUES, WARMUP_ACTIONS],
    ] as const) {
      const ids = cues.flatMap((c) => c.actions.map((a) => a.id));
      expect(ids).toEqual(actions.map((a) => a.id));
      cues.forEach((c, i) =>
        expect(c.requires).toEqual(i === 0 ? [] : [cues[i - 1]!.id]),
      );
    }
  });
});

describe("warmup-v1 schedule", () => {
  it("trades AERIUM only with four headlines and ends at 05:00", () => {
    const symbols = new Set<string>();
    for (const a of WARMUP_ACTIONS) {
      if (a.kind === "list_underlying" || a.kind === "list_etf")
        symbols.add(a.config.symbol);
      if (a.kind === "news")
        for (const t of a.news.targets ?? []) symbols.add(t);
      expect(a.kind).not.toMatch(/^bond/);
    }
    expect([...symbols]).toEqual(["AERIUM"]);
    expect(WARMUP_ACTIONS.filter((a) => a.kind === "news")).toHaveLength(4);
    expect(WARMUP_ACTIONS.at(-1)).toMatchObject({ kind: "end", atSecond: 300 });
  });
});
