/**
 * Public timing and instruments of the Fresher Sprint and its warm-up, in
 * game seconds from `startsAt`. Browsers import this module (countdowns,
 * "unlocks at 05:00"), so it must never reference headlines, their
 * classification or fair-value effects (those live in `fresher-event.ts`).
 */
import type {
  BondTemplate,
  ChallengeConfig,
  EdenBotConfig,
  SymbolConfig,
} from "./schemas.js";
import type { FresherScriptId } from "./eden-presets.js";

export const FRESHER_VERSION = "fresher-v1";
export const WARMUP_VERSION = "warmup-v1";

export const FRESHER_DURATION_MINUTES = 30;
export const WARMUP_DURATION_MINUTES = 5;

export interface FresherInstrument {
  symbol: string;
  name: string;
  description: string;
  initialPrice: number;
  tickSize: number;
  /** Game minute the instrument becomes tradable. */
  listMinute: number;
  kind: "spot" | "etf";
}

export const FRESHER_INSTRUMENTS: readonly FresherInstrument[] = [
  {
    symbol: "AERIUM",
    name: "Aerium Logistics",
    description:
      "Ports, shipping and supply chains. Moves on cargo and fuel news.",
    initialPrice: 1000,
    tickSize: 0.5,
    listMinute: 0,
    kind: "spot",
  },
  {
    symbol: "NEURO",
    name: "Neuro-Chips",
    description: "AI and smartphone chips. Moves on product and supply news.",
    initialPrice: 750,
    tickSize: 0.5,
    listMinute: 5,
    kind: "spot",
  },
  {
    symbol: "SOLAR",
    name: "Solar Grid",
    description:
      "Solar power plants and storage. Moves on weather and regulation.",
    initialPrice: 800,
    tickSize: 0.5,
    listMinute: 10,
    kind: "spot",
  },
  {
    symbol: "ORBIT",
    name: "Orbital Mobility",
    description:
      "Electric buses and city transport. Moves on contracts and policy.",
    initialPrice: 600,
    tickSize: 0.5,
    listMinute: 15,
    kind: "spot",
  },
  {
    symbol: "MARKETX",
    name: "Market-X",
    description:
      "ETF tracking 0.4 x AERIUM + 0.6 x NEURO. Trades like a stock; can drift to a premium or discount.",
    initialPrice: 850,
    tickSize: 0.5,
    listMinute: 20,
    kind: "etf",
  },
];

/** Market-X fair value = 0.4 x AERIUM + 0.6 x NEURO. */
export const FRESHER_ETF_BASKET = [
  { symbol: "AERIUM", weight: 0.4 },
  { symbol: "NEURO", weight: 0.6 },
] as const;

export function fresherSymbolConfig(symbol: string): SymbolConfig {
  const i = FRESHER_INSTRUMENTS.find((x) => x.symbol === symbol);
  if (!i) throw new Error(`Unknown Fresher instrument ${symbol}`);
  return {
    symbol: i.symbol,
    name: i.name,
    initialPrice: i.initialPrice,
    volatility: 0,
    tickSize: i.tickSize,
  };
}

/* ---- Bond ---- */
export const FRESHER_BOND_ID = "fresher_bond";
export const FRESHER_BOND_OPEN_SECOND = 10 * 60;
export const FRESHER_BOND_CLOSE_SECOND = 20 * 60;
/** 12:30, 15:00, ... 27:30 — seven coupons before maturity. */
export const FRESHER_BOND_COUPON_SECONDS = [
  750, 900, 1050, 1200, 1350, 1500, 1650,
] as const;
export const FRESHER_BOND_MATURITY_SECOND = 30 * 60;
export const FRESHER_BOND_DEFAULTS = {
  totalReturn: 1.5,
  minPrincipal: 5_000,
  maxPrincipal: 20_000,
} as const;

/** The bond template, with host-tunable terms (dry-run calibration). */
export function fresherBondTemplate(
  terms: Partial<{
    totalReturn: number;
    minPrincipal: number;
    maxPrincipal: number;
  }> = {},
): BondTemplate {
  const t = { ...FRESHER_BOND_DEFAULTS, ...terms };
  return {
    id: FRESHER_BOND_ID,
    name: "Fresher Bond",
    price: t.minPrincipal,
    faceValue: t.minPrincipal * t.totalReturn,
    payoutMultiplier: t.totalReturn,
    maxPerUser: 1,
    schedule: {
      closesAtSecond: FRESHER_BOND_CLOSE_SECOND,
      couponSeconds: [...FRESHER_BOND_COUPON_SECONDS],
      maturitySecond: FRESHER_BOND_MATURITY_SECOND,
      totalReturn: t.totalReturn,
      minPrincipal: t.minPrincipal,
      maxPrincipal: t.maxPrincipal,
    },
  };
}

/* ---- Pause, leaderboard, headlines ---- */
export const FRESHER_PAUSE_SECOND = 25 * 60;
export const FRESHER_PAUSE_LENGTH_SEC = 15;
/** Rankings: hidden 0-5, shown 5-25, hidden 25-30, final after settlement. */
export const FRESHER_LEADERBOARD_SHOW_SECOND = 5 * 60;
export const FRESHER_LEADERBOARD_HIDE_SECOND = 25 * 60;
/** One public headline at the top of each of these minutes. */
export const FRESHER_NEWS_MINUTES = Array.from({ length: 29 }, (_, i) => i + 1);
export const WARMUP_NEWS_MINUTES = [1, 2, 3, 4] as const;

export function scriptDurationMinutes(script: FresherScriptId): number {
  return script === "warmup-v1"
    ? WARMUP_DURATION_MINUTES
    : FRESHER_DURATION_MINUTES;
}

/** Instruments a script lists (the warm-up trades AERIUM only). */
export function scriptInstruments(
  script: FresherScriptId,
): readonly FresherInstrument[] {
  return script === "warmup-v1"
    ? FRESHER_INSTRUMENTS.filter((i) => i.symbol === "AERIUM")
    : FRESHER_INSTRUMENTS;
}

export interface FresherPhase {
  /** Whole seconds since the open (negative before it). */
  second: number;
  started: boolean;
  ended: boolean;
  paused: boolean;
  /** Seconds until the closing bell (0 once ended). */
  remainingSec: number;
  listed: string[];
  nextListing: { symbol: string; atSecond: number } | null;
  bondOpen: boolean;
  nextCoupon: { index: number; atSecond: number } | null;
  leaderboardVisible: boolean;
  finalPhase: boolean;
}

/** What a script's schedule says should be true at game second `second`. */
export function fresherPhaseAt(
  script: FresherScriptId,
  second: number,
): FresherPhase {
  const duration = scriptDurationMinutes(script) * 60;
  const warmup = script === "warmup-v1";
  const instruments = scriptInstruments(script);
  const listed = instruments
    .filter((i) => second >= i.listMinute * 60)
    .map((i) => i.symbol);
  const upcoming = instruments.find((i) => second < i.listMinute * 60);
  const couponIdx = FRESHER_BOND_COUPON_SECONDS.findIndex((s) => second < s);
  return {
    second,
    started: second >= 0,
    ended: second >= duration,
    paused:
      !warmup &&
      second >= FRESHER_PAUSE_SECOND &&
      second < FRESHER_PAUSE_SECOND + FRESHER_PAUSE_LENGTH_SEC,
    remainingSec: Math.max(0, duration - Math.max(0, second)),
    listed,
    nextListing: upcoming
      ? { symbol: upcoming.symbol, atSecond: upcoming.listMinute * 60 }
      : null,
    bondOpen:
      !warmup &&
      second >= FRESHER_BOND_OPEN_SECOND &&
      second < FRESHER_BOND_CLOSE_SECOND,
    nextCoupon:
      warmup || couponIdx < 0 || second < FRESHER_BOND_OPEN_SECOND
        ? null
        : {
            index: couponIdx,
            atSecond: FRESHER_BOND_COUPON_SECONDS[couponIdx]!,
          },
    leaderboardVisible: warmup
      ? second < duration
      : second >= FRESHER_LEADERBOARD_SHOW_SECOND &&
        second < FRESHER_LEADERBOARD_HIDE_SECOND,
    finalPhase: !warmup && second >= FRESHER_PAUSE_SECOND && second < duration,
  };
}

/** "05:00" style game clock label. */
export function gameClockLabel(second: number): string {
  const s = Math.max(0, Math.floor(second));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ---- Challenge preset ---- */

export const FRESHER_STARTING_CASH = 100_000;
export const FRESHER_ORDER_QTY_PRESETS: [number, number, number, number] = [
  1, 5, 10, 25,
];

/**
 * Bot mixes compared in dry runs before the event config is final:
 *   none    - players provide all liquidity (load tests; QuantStorm finals ran
 *             without bots)
 *   passive - light two-sided market makers around fair value, no momentum
 *   active  - market makers plus momentum bots that react to headlines
 */
export type FresherBotMode = "none" | "passive" | "active";

export function fresherBots(mode: FresherBotMode): EdenBotConfig {
  const off = { vegaSnipers: 0, parityArbers: 0 };
  switch (mode) {
    case "none":
      return {
        ...off,
        hftMarketMakers: 0,
        momentumTraders: 0,
        spread: 1,
        quoteSize: 10,
        intensity: 0.3,
      };
    case "passive":
      return {
        ...off,
        hftMarketMakers: 2,
        momentumTraders: 0,
        spread: 1,
        quoteSize: 10,
        intensity: 0.3,
      };
    case "active":
      return {
        ...off,
        hftMarketMakers: 3,
        momentumTraders: 2,
        spread: 1,
        quoteSize: 25,
        intensity: 0.5,
      };
  }
}

/**
 * Full challenge config for the Fresher Sprint or its warm-up: strict risk
 * (no leverage, loans or negative cash; orders rejected, never trimmed),
 * +/-100 per instrument, 25 per order, 10 open orders, no holding cost or
 * forced liquidation. Bots and bond terms are chosen per dry run.
 */
export function fresherChallengeConfig(
  script: FresherScriptId,
  bondTerms: Partial<{
    totalReturn: number;
    minPrincipal: number;
    maxPrincipal: number;
  }> = {},
  bots: FresherBotMode = "passive",
): ChallengeConfig {
  return {
    symbols: [fresherSymbolConfig("AERIUM")],
    startingCash: FRESHER_STARTING_CASH,
    minPosition: -100,
    maxPosition: 100,
    maxOrderQuantity: 25,
    maxOpenOrders: 10,
    maxOrdersPerSecond: 5,
    maxVolumePerMinute: 10_000,
    allowMargin: false,
    strictRisk: true,
    autonomousPrice: true,
    orderQtyPresets: [...FRESHER_ORDER_QTY_PRESETS],
    eden: {
      script,
      rules: {
        enabled: true,
        costOfCarryPerUnitPerMinute: 0,
        loanRepayMultiplier: 2,
        // Strict risk already forbids negative cash; never margin-call.
        marginCallThreshold: -1_000_000_000,
        forcedLiquidation: false,
        positionCap: 100,
      },
      bots: fresherBots(bots),
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
      ...(script === "fresher-v1"
        ? { fresherBond: { ...FRESHER_BOND_DEFAULTS, ...bondTerms } }
        : {}),
      auctionDurationSec: 30,
      auctionWinnerFraction: 0.3,
      premiumLeadSec: 10,
      premiumAccessMinutes: 15,
      otcReplySec: 40,
    },
  };
}
