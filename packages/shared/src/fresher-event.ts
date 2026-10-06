/**
 * Fresher Sprint scripts (server only): the 30-minute game and its 5-minute
 * warm-up. Receipt ids are `fresher-v1/*` and `warmup-v1/*`; never renumber
 * them for an event in flight. The web app must not import from this module
 * (headline classifications and fair-value effects would leak); public
 * timing lives in `fresher-clock.ts`.
 */
import type {
  EdenEventAction,
  EdenEventCue,
  EdenEventPayload,
  EdenNews,
} from "./eden-event.js";
import type { FresherScriptId } from "./eden-presets.js";
import {
  FRESHER_BOND_CLOSE_SECOND,
  FRESHER_BOND_COUPON_SECONDS,
  FRESHER_BOND_ID,
  FRESHER_BOND_MATURITY_SECOND,
  FRESHER_BOND_OPEN_SECOND,
  FRESHER_DURATION_MINUTES,
  FRESHER_ETF_BASKET,
  FRESHER_INSTRUMENTS,
  FRESHER_LEADERBOARD_HIDE_SECOND,
  FRESHER_LEADERBOARD_SHOW_SECOND,
  FRESHER_PAUSE_LENGTH_SEC,
  FRESHER_PAUSE_SECOND,
  FRESHER_VERSION,
  WARMUP_DURATION_MINUTES,
  WARMUP_VERSION,
  fresherBondTemplate,
  fresherSymbolConfig,
  gameClockLabel,
} from "./fresher-clock.js";

/** Debrief category; traders never see it during play. */
export type FresherCategory = "signal" | "noise" | "market-wide";

export interface FresherHeadline {
  minute: number;
  targets: readonly string[];
  headline: string;
  category: FresherCategory;
  /** Fair-value change per instrument (signals only). */
  fv: Readonly<Record<string, number>>;
  /** Momentum-bot impulse per instrument (+1 buy / -1 sell). */
  momentum: Readonly<Record<string, -1 | 1>>;
  lesson: string;
}

const STOCKS = ["AERIUM", "NEURO", "SOLAR", "ORBIT"] as const;

/** The 29 game headlines, one per minute 1-29. */
export const FRESHER_HEADLINES: readonly FresherHeadline[] = [
  {
    minute: 1,
    targets: ["AERIUM"],
    headline:
      "Aerium Logistics confirms today's shipping schedule is unchanged.",
    category: "noise",
    fv: {},
    momentum: {},
    lesson: "Not every headline matters.",
  },
  {
    minute: 2,
    targets: ["AERIUM"],
    headline:
      "Aerium Logistics wins a three-year port-handling contract larger than its last quarter's revenue.",
    category: "signal",
    fv: { AERIUM: 40 },
    momentum: { AERIUM: 1 },
    lesson: "Act on real information quickly.",
  },
  {
    minute: 3,
    targets: ["AERIUM"],
    headline:
      'A popular finance influencer calls Aerium "the next big thing" in a short video.',
    category: "noise",
    fv: {},
    momentum: { AERIUM: 1 },
    lesson: "Hype moves price, not value; fade it.",
  },
  {
    minute: 4,
    targets: ["AERIUM"],
    headline:
      "Fuel costs at Aerium's main hub rise 6% after a supplier price revision.",
    category: "signal",
    fv: { AERIUM: -25 },
    momentum: { AERIUM: -1 },
    lesson: "Bad news: sell or short.",
  },
  {
    minute: 5,
    targets: ["NEURO"],
    headline:
      "Neuro-Chips' first AI accelerator passes independent benchmark tests.",
    category: "signal",
    fv: { NEURO: 30 },
    momentum: { NEURO: 1 },
    lesson: "A new listing is a fresh opportunity.",
  },
  {
    minute: 6,
    targets: ["NEURO"],
    headline:
      "Neuro-Chips' CEO will speak at a technology conference next month.",
    category: "noise",
    fv: {},
    momentum: { NEURO: 1 },
    lesson: "A scheduled appearance is not news.",
  },
  {
    minute: 7,
    targets: ["AERIUM"],
    headline:
      "Aerium wins an emergency contract to reroute shipments around a closed canal.",
    category: "signal",
    fv: { AERIUM: 35 },
    momentum: { AERIUM: 1 },
    lesson: "Trends can reverse after bad news.",
  },
  {
    minute: 8,
    targets: ["NEURO"],
    headline:
      "Neuro-Chips recalls a small batch of chips; the company says the cost is under 1% of annual revenue.",
    category: "signal",
    fv: { NEURO: -20 },
    momentum: { NEURO: -1 },
    lesson: "Size the reaction to the magnitude.",
  },
  {
    minute: 9,
    targets: ["NEURO"],
    headline:
      "Forum rumour: a big tech firm is about to acquire Neuro-Chips. The company declined to comment.",
    category: "noise",
    fv: {},
    momentum: { NEURO: 1 },
    lesson: "Unverified rumours.",
  },
  {
    minute: 10,
    targets: ["SOLAR"],
    headline:
      "The regulator approves Solar Grid's new 500 MW plant ahead of schedule.",
    category: "signal",
    fv: { SOLAR: 30 },
    momentum: { SOLAR: 1 },
    lesson: "New listing versus locking cash in the bond.",
  },
  {
    minute: 11,
    targets: ["AERIUM"],
    headline:
      "Aerium's quarterly volumes rise 8%, exactly in line with analyst expectations.",
    category: "noise",
    fv: {},
    momentum: { AERIUM: 1 },
    lesson: '"As expected" is already in the price.',
  },
  {
    minute: 12,
    targets: ["SOLAR"],
    headline:
      "The weather service forecasts two weeks of heavy cloud over Solar Grid's largest farms.",
    category: "signal",
    fv: { SOLAR: -35 },
    momentum: { SOLAR: -1 },
    lesson: "Sector-specific risk.",
  },
  {
    minute: 13,
    targets: ["NEURO"],
    headline:
      "Neuro-Chips signs a supply contract with a major smartphone maker.",
    category: "signal",
    fv: { NEURO: 45 },
    momentum: { NEURO: 1 },
    lesson: "Strong positive signal.",
  },
  {
    minute: 14,
    targets: ["SOLAR"],
    headline: "Solar Grid unveils a redesigned company logo.",
    category: "noise",
    fv: {},
    momentum: {},
    lesson: "Cosmetic news.",
  },
  {
    minute: 15,
    targets: ["ORBIT"],
    headline:
      "The city transit authority picks Orbital Mobility's electric buses for a pilot route.",
    category: "signal",
    fv: { ORBIT: 25 },
    momentum: { ORBIT: 1 },
    lesson: "Fourth instrument: diversification.",
  },
  {
    minute: 16,
    targets: ["NEURO", "SOLAR"],
    headline:
      "The government raises import duties on electronic components; domestic solar makers are exempt and favoured.",
    category: "market-wide",
    fv: { NEURO: -35, SOLAR: 20 },
    momentum: { NEURO: -1, SOLAR: 1 },
    lesson: "One headline, opposite effects: rotate.",
  },
  {
    minute: 17,
    targets: ["ORBIT"],
    headline:
      "A transport blogger posts a negative review of an Orbital Mobility scooter.",
    category: "noise",
    fv: {},
    momentum: { ORBIT: -1 },
    lesson: "One opinion is not fundamentals.",
  },
  {
    minute: 18,
    targets: ["SOLAR"],
    headline:
      "A fire at Solar Grid's battery storage unit halts one site for a week.",
    category: "signal",
    fv: { SOLAR: -30 },
    momentum: { SOLAR: -1 },
    lesson: "Operational shock.",
  },
  {
    minute: 19,
    targets: ["ORBIT"],
    headline:
      "Orbital Mobility wins a city-wide order for 2,000 electric autos.",
    category: "signal",
    fv: { ORBIT: 30 },
    momentum: { ORBIT: 1 },
    lesson: "Contract wins move value.",
  },
  {
    minute: 20,
    targets: ["NEURO"],
    headline:
      "Analysts expect the Market-X launch to bring new buyers into Neuro-Chips.",
    category: "noise",
    fv: {},
    momentum: { NEURO: 1 },
    lesson: "Market-X follows NEURO's value, not hype.",
  },
  {
    minute: 21,
    targets: ["AERIUM"],
    headline:
      "Aerium's largest customer announces it is moving its business to a competitor.",
    category: "signal",
    fv: { AERIUM: -50 },
    momentum: { AERIUM: -1 },
    lesson: "Moves Market-X too (40% weight).",
  },
  {
    minute: 22,
    targets: ["NEURO"],
    headline: "Neuro-Chips' new factory begins production two months early.",
    category: "signal",
    fv: { NEURO: 40 },
    momentum: { NEURO: 1 },
    lesson: "Moves Market-X more (60% weight).",
  },
  {
    minute: 23,
    targets: [...STOCKS],
    headline:
      "The central bank holds interest rates steady, as widely expected.",
    category: "market-wide",
    fv: {},
    momentum: {},
    lesson: "A macro non-event.",
  },
  {
    minute: 24,
    targets: ["ORBIT"],
    headline:
      "Orbital Mobility will publish its ridership numbers after the market closes.",
    category: "noise",
    fv: {},
    momentum: {},
    lesson: "Information arriving later is not news now.",
  },
  {
    minute: 25,
    targets: ["AERIUM", "SOLAR", "ORBIT"],
    headline:
      "The government launches a national clean-mobility subsidy, funded by cutting logistics fuel subsidies.",
    category: "market-wide",
    fv: { ORBIT: 50, SOLAR: 40, AERIUM: -40 },
    momentum: { ORBIT: 1, SOLAR: 1, AERIUM: -1 },
    lesson: "Big shock: final-phase risk.",
  },
  {
    minute: 26,
    targets: ["NEURO", "ORBIT"],
    headline: "The global chip shortage worsens; component prices spike.",
    category: "market-wide",
    fv: { NEURO: 30, ORBIT: -30 },
    momentum: { NEURO: 1, ORBIT: -1 },
    lesson: "Supplier gains, buyer loses.",
  },
  {
    minute: 27,
    targets: ["SOLAR"],
    headline: 'Solar Grid\'s chief engineer says "next year will be exciting."',
    category: "noise",
    fv: {},
    momentum: { SOLAR: 1 },
    lesson: "Vague optimism.",
  },
  {
    minute: 28,
    targets: [...STOCKS],
    headline: "The broad market index dips 1% in early trade on global cues.",
    category: "market-wide",
    fv: {},
    momentum: { AERIUM: -1, NEURO: -1, SOLAR: -1, ORBIT: -1 },
    lesson: "Market noise; do not panic-sell.",
  },
  {
    minute: 29,
    targets: ["NEURO"],
    headline: "Neuro-Chips delays its next product by one quarter.",
    category: "signal",
    fv: { NEURO: -40 },
    momentum: { NEURO: -1 },
    lesson: "Closing risk: who holds into the bell?",
  },
];

/** Warm-up practice headlines (AERIUM only). */
export const WARMUP_HEADLINES: readonly FresherHeadline[] = [
  {
    minute: 1,
    targets: ["AERIUM"],
    headline: "Practice: Aerium reports record cargo volumes this week.",
    category: "signal",
    fv: { AERIUM: 30 },
    momentum: { AERIUM: 1 },
    lesson: "Buy on good news.",
  },
  {
    minute: 2,
    targets: ["AERIUM"],
    headline: 'Practice: a commentator says Aerium "looks expensive".',
    category: "noise",
    fv: {},
    momentum: { AERIUM: -1 },
    lesson: "Opinions are noise.",
  },
  {
    minute: 3,
    targets: ["AERIUM"],
    headline: "Practice: a storm closes one of Aerium's ports for two days.",
    category: "signal",
    fv: { AERIUM: -25 },
    momentum: { AERIUM: -1 },
    lesson: "Sell on bad news.",
  },
  {
    minute: 4,
    targets: ["AERIUM"],
    headline: "Practice: Aerium updates its website.",
    category: "noise",
    fv: {},
    momentum: {},
    lesson: "Not every headline matters.",
  },
];

function toEdenNews(version: string, h: FresherHeadline): EdenNews {
  return {
    id: `${version}/news/${h.minute}`,
    minute: h.minute,
    // The engine stores signal/noise; market-wide items count as signal when
    // they move value and noise when they do not.
    classification:
      h.category === "noise" ||
      (h.category === "market-wide" && Object.keys(h.fv).length === 0)
        ? "noise"
        : "signal",
    headline: h.headline,
    effects: Object.entries(h.fv).map(([symbol, value]) => ({
      symbol,
      operation: "delta" as const,
      value,
    })),
    momentum: Object.entries(h.momentum).map(([symbol, direction]) => ({
      symbol,
      direction,
    })),
    original: true,
    targets: h.targets,
    leadSec: 0,
  };
}

function money(n: number): string {
  return `INR ${n.toLocaleString("en-IN")}`;
}

function buildFresher(): readonly EdenEventAction[] {
  const actions: EdenEventAction[] = [];
  const add = (id: string, atSecond: number, payload: EdenEventPayload) =>
    actions.push({ id: `${FRESHER_VERSION}/${id}`, atSecond, ...payload });
  const bond = fresherBondTemplate();
  const terms = bond.schedule!;

  // 00:00 Opening bell.
  add("open", 0, {
    kind: "market_open",
    symbol: fresherSymbolConfig("AERIUM"),
  });
  add("leaderboard/hide", 0, { kind: "leaderboard_visibility", hidden: true });
  add("announce/open", 0, {
    kind: "announce",
    level: "info",
    message:
      "Opening bell. AERIUM (Aerium Logistics) is live. A new instrument lists every 5 minutes. Orders up to 25 units, positions between -100 and +100, no borrowing. Rankings appear at 05:00.",
  });

  for (const inst of FRESHER_INSTRUMENTS) {
    if (inst.listMinute === 0) continue;
    const at = inst.listMinute * 60;
    if (inst.kind === "spot") {
      add(`list/${inst.symbol.toLowerCase()}`, at, {
        kind: "list_underlying",
        config: fresherSymbolConfig(inst.symbol),
      });
    }
    // Market-X lists after the 20:00 coupon and bond close (pushed below).
  }

  // Leaderboard opens at 05:00.
  add("leaderboard/show", FRESHER_LEADERBOARD_SHOW_SECOND, {
    kind: "leaderboard_visibility",
    hidden: false,
  });

  // 10:00 Bond subscription opens.
  add("bond/open", FRESHER_BOND_OPEN_SECOND, { kind: "bond_available", bond });
  add("announce/bond-open", FRESHER_BOND_OPEN_SECOND, {
    kind: "announce",
    level: "warning",
    message: `Bond subscription is open until ${gameClockLabel(FRESHER_BOND_CLOSE_SECOND)}. Invest ${money(terms.minPrincipal)} to ${money(terms.maxPrincipal)} once. Coupons every 2.5 minutes from ${gameClockLabel(terms.couponSeconds[0]!)}; principal back at ${gameClockLabel(terms.maturitySecond)}. Invested cash is locked until then.`,
  });

  // Coupons 12:30 ... 27:30 (the 20:00 coupon precedes the close).
  FRESHER_BOND_COUPON_SECONDS.forEach((at, index) => {
    add(`bond/coupon/${index + 1}`, at, {
      kind: "bond_coupon",
      bondId: FRESHER_BOND_ID,
      index,
      maturity: false,
    });
    if (at === FRESHER_BOND_CLOSE_SECOND) {
      add("bond/close", at, { kind: "bond_close", bondId: FRESHER_BOND_ID });
      add("announce/bond-close", at, {
        kind: "announce",
        level: "info",
        message:
          "Bond subscription is closed. Holders keep receiving coupons until maturity at 30:00.",
      });
    }
  });

  // 20:00 Market-X, after the coupon and the bond close.
  const etf = FRESHER_INSTRUMENTS.find((i) => i.kind === "etf")!;
  add(`list/${etf.symbol.toLowerCase()}`, etf.listMinute * 60, {
    kind: "list_etf",
    config: {
      symbol: etf.symbol,
      name: etf.name,
      basket: FRESHER_ETF_BASKET.map((c) => ({ ...c })),
      tickSize: etf.tickSize,
      seedFromMids: true,
    },
  });

  // Listing announcements, before that minute's headline.
  for (const inst of FRESHER_INSTRUMENTS) {
    if (inst.listMinute === 0) continue;
    add(`announce/list/${inst.symbol.toLowerCase()}`, inst.listMinute * 60, {
      kind: "announce",
      level: "warning",
      message: `New listing: ${inst.symbol} (${inst.name}) is now tradable. ${inst.description}`,
    });
  }

  // 25:00 Final phase: pause, announcement, headline, coupon, hide rankings.
  add("pause", FRESHER_PAUSE_SECOND, {
    kind: "freeze",
    reason: "pause",
    message: `Final phase. Trading is paused for ${FRESHER_PAUSE_LENGTH_SEC} seconds: read the next headline. Your resting orders stay on the book and you can cancel them. Rankings are hidden until the final results.`,
  });

  for (const h of FRESHER_HEADLINES) {
    add(`news/${h.minute}`, h.minute * 60, {
      kind: "news",
      audience: "public",
      news: toEdenNews(FRESHER_VERSION, h),
    });
  }

  add("leaderboard/hide-final", FRESHER_LEADERBOARD_HIDE_SECOND, {
    kind: "leaderboard_visibility",
    hidden: true,
  });
  add("resume", FRESHER_PAUSE_SECOND + FRESHER_PAUSE_LENGTH_SEC, {
    kind: "unfreeze",
    message: "Trading has resumed. The closing bell is at 30:00.",
  });

  // 30:00 Maturity, then the closing bell (settlement and final rankings).
  add("bond/maturity", FRESHER_BOND_MATURITY_SECOND, {
    kind: "bond_coupon",
    bondId: FRESHER_BOND_ID,
    index: FRESHER_BOND_COUPON_SECONDS.length,
    maturity: true,
  });
  add("end", FRESHER_DURATION_MINUTES * 60, { kind: "end" });

  return orderedBySecond(actions);
}

function buildWarmup(): readonly EdenEventAction[] {
  const actions: EdenEventAction[] = [];
  const add = (id: string, atSecond: number, payload: EdenEventPayload) =>
    actions.push({ id: `${WARMUP_VERSION}/${id}`, atSecond, ...payload });
  add("open", 0, {
    kind: "market_open",
    symbol: fresherSymbolConfig("AERIUM"),
  });
  add("leaderboard/show", 0, { kind: "leaderboard_visibility", hidden: false });
  add("announce/open", 0, {
    kind: "announce",
    level: "info",
    message:
      "Warm-up: practice market orders, limit orders and cancelling on AERIUM. Scores here do not count.",
  });
  for (const h of WARMUP_HEADLINES) {
    add(`news/${h.minute}`, h.minute * 60, {
      kind: "news",
      audience: "public",
      news: toEdenNews(WARMUP_VERSION, h),
    });
  }
  add("end", WARMUP_DURATION_MINUTES * 60, { kind: "end" });
  return orderedBySecond(actions);
}

/**
 * Stable sort by second; within a second, the order of the rules below,
 * then insertion order. The spec fixes these ties:
 *   listing before headline; at 20:00 coupon, close, list Market-X, headline;
 *   at 25:00 pause, announcement, headline, coupon, hide rankings;
 *   at 30:00 maturity before the closing bell.
 */
function orderedBySecond(actions: EdenEventAction[]): EdenEventAction[] {
  const rank = (a: EdenEventAction): number => {
    switch (a.kind) {
      case "market_open":
        return 0;
      case "freeze":
        return 1;
      case "bond_coupon":
        return a.atSecond === FRESHER_PAUSE_SECOND ? 6 : a.maturity ? 8 : 2;
      case "bond_close":
        return 3;
      case "list_underlying":
      case "list_etf":
        return 4;
      case "bond_available":
        return 4;
      case "announce":
        return 5;
      case "news":
        return 5.5;
      case "leaderboard_visibility":
        return 7;
      case "unfreeze":
        return 7;
      case "end":
        return 9;
      default:
        return 5;
    }
  };
  return actions
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        x.a.atSecond - y.a.atSecond || rank(x.a) - rank(y.a) || x.i - y.i,
    )
    .map(({ a }) => a);
}

export const FRESHER_ACTIONS = /*#__PURE__*/ buildFresher();
export const WARMUP_ACTIONS = /*#__PURE__*/ buildWarmup();

export function scriptActions(
  script: FresherScriptId,
): readonly EdenEventAction[] {
  return script === "warmup-v1" ? WARMUP_ACTIONS : FRESHER_ACTIONS;
}

export function scriptHeadlines(
  script: FresherScriptId,
): readonly FresherHeadline[] {
  return script === "warmup-v1" ? WARMUP_HEADLINES : FRESHER_HEADLINES;
}

/**
 * Host-fired fallback cue sheet, generated from the same actions: one cue
 * per scheduled second. Cue and automatic runs share action receipts, so
 * firing a cue the clock already ran (or the reverse) never duplicates it.
 */
function buildCues(
  actions: readonly EdenEventAction[],
): readonly EdenEventCue[] {
  const bySecond = new Map<number, EdenEventAction[]>();
  for (const a of actions) {
    const list = bySecond.get(a.atSecond) ?? [];
    list.push(a);
    bySecond.set(a.atSecond, list);
  }
  const seconds = [...bySecond.keys()].sort((a, b) => a - b);
  const cueId = (second: number) => `t${second}`;
  return seconds.map((second, i) => {
    const group = bySecond.get(second)!;
    const kinds = new Set(group.map((a) => a.kind));
    const label = group
      .map((a) => {
        switch (a.kind) {
          case "market_open":
            return "Open market";
          case "list_underlying":
            return `List ${a.config.symbol}`;
          case "list_etf":
            return `List ${a.config.symbol}`;
          case "news":
            return `Headline ${a.news.minute}`;
          case "bond_available":
            return "Open bond";
          case "bond_close":
            return "Close bond";
          case "bond_coupon":
            return a.maturity ? "Bond maturity" : `Coupon ${a.index + 1}`;
          case "freeze":
            return "Pause";
          case "unfreeze":
            return "Resume";
          case "leaderboard_visibility":
            return a.hidden ? "Hide rankings" : "Show rankings";
          case "end":
            return "Closing bell";
          default:
            return null;
        }
      })
      .filter(Boolean)
      .join(" · ");
    return {
      id: cueId(second),
      label: `${gameClockLabel(second)}  ${label}`,
      minute: second / 60,
      kind: kinds.has("news") && kinds.size === 1 ? "news" : "market",
      actions: group,
      // Strictly in order: each beat needs the previous one.
      requires: i === 0 ? [] : [cueId(seconds[i - 1]!)],
    };
  });
}

export const FRESHER_CUES = /*#__PURE__*/ buildCues(FRESHER_ACTIONS);
export const WARMUP_CUES = /*#__PURE__*/ buildCues(WARMUP_ACTIONS);

export function scriptCues(script: FresherScriptId): readonly EdenEventCue[] {
  return script === "warmup-v1" ? WARMUP_CUES : FRESHER_CUES;
}
