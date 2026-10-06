import {
  FRESHER_INSTRUMENTS,
  fresherPhaseAt,
  gameClockLabel,
  scriptDurationMinutes,
  type Challenge,
  type FresherPhase,
  type FresherScriptId,
  type OrderRejectReason,
} from "@qtp/shared";

export interface FresherClock {
  script: FresherScriptId;
  /** Game seconds since the open (negative before it). */
  second: number;
  /** Wall ms per game minute (60 000 at the real event). */
  minuteMs: number;
  phase: FresherPhase;
  /** Wall ms until a game second, for countdowns. */
  msUntil: (second: number) => number;
}

/** Game clock from the server time and the challenge's pinned schedule. */
export function fresherClock(
  challenge: Pick<Challenge, "startsAt" | "endsAt" | "config">,
  serverNow: number,
): FresherClock | null {
  const script = challenge.config.eden?.script;
  if (!script || !challenge.startsAt) return null;
  const start = Date.parse(challenge.startsAt);
  const duration = scriptDurationMinutes(script);
  // The engine pins endsAt = startsAt + duration x minute once it starts;
  // before that, assume real-time minutes.
  const end = challenge.endsAt ? Date.parse(challenge.endsAt) : NaN;
  const minuteMs =
    Number.isFinite(end) && end > start ? (end - start) / duration : 60_000;
  const second = ((serverNow - start) / minuteMs) * 60;
  return {
    script,
    second,
    minuteMs,
    phase: fresherPhaseAt(script, second),
    msUntil: (s) => start + (s * minuteMs) / 60 - serverNow,
  };
}

/** "NEURO unlocks at 05:00" for an instrument not listed yet. */
export function unlockLabel(symbol: string): string | null {
  const inst = FRESHER_INSTRUMENTS.find((i) => i.symbol === symbol);
  return inst ? gameClockLabel(inst.listMinute * 60) : null;
}

/** Plain-language text for an engine or API order rejection. */
export function orderRejectText(
  reason: OrderRejectReason | string | undefined,
  ctx: { symbol: string; maxQuantity?: number; maxOpenOrders?: number },
): string {
  const unlock = unlockLabel(ctx.symbol);
  switch (reason) {
    case "not_listed":
    case "unknown_symbol":
    case "symbol_locked":
      return unlock
        ? `${ctx.symbol} is not listed yet. It unlocks at ${unlock}.`
        : `${ctx.symbol} is not tradable.`;
    case "market_paused":
    case "market_frozen":
      return "Market is paused. New orders open again shortly; you can still cancel.";
    case "market_closed":
    case "challenge_not_live":
      return "Market is closed.";
    case "order_too_large":
      return `Order exceeds ${ctx.maxQuantity ?? 25} units. Split it into smaller orders.`;
    case "too_many_open_orders":
    case "open_orders_exceeded":
      return `You have ${ctx.maxOpenOrders ?? 10} open orders. Cancel one to place another.`;
    case "position_limit":
    case "no_capacity":
      return "Position would pass -100/+100 (working orders count). Reduce size or cancel orders.";
    case "insufficient_cash":
      return "Insufficient available cash (your open buy orders also hold cash).";
    case "exposure_limit":
      return "Total exposure would exceed your trading equity. No leverage: close or reduce a position first.";
    case "invalid_price":
      return "Price must be positive and a multiple of the tick size (0.50).";
    case "invalid_quantity":
      return "Enter a whole quantity of at least 1.";
    case "rate_limited":
      return "Too many orders. Slow down and retry.";
    default:
      return "Order rejected.";
  }
}

/** Format name shown on cards and the terminal header. */
export function formatLabel(
  challenge: Pick<Challenge, "type" | "config">,
): string {
  const script = challenge.config.eden?.script;
  if (script === "fresher-v1") return "Fresher Sprint";
  if (script === "warmup-v1") return "Warm-up";
  if (challenge.type === "market_making") return "Market making";
  if (challenge.type === "new_eden") return "New Eden";
  return "Directional";
}
