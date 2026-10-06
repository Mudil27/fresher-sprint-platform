"use client";

import {
  FRESHER_BOND_COUPON_SECONDS,
  gameClockLabel,
  scriptDurationMinutes,
  type Challenge,
} from "@qtp/shared";
import { fresherClock } from "@/lib/fresher";
import { useServerNow } from "@/lib/serverClock";
import { clock } from "@/lib/format";
import { cn } from "@/lib/cn";

function Chip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "accent";
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-baseline gap-1.5 rounded-sm border px-2 py-1 text-xs",
        tone === "warn"
          ? "border-down/40 bg-down-subtle text-down"
          : tone === "accent"
            ? "border-accent/40 bg-accent-subtle text-accent"
            : "border-border bg-surface-2 text-muted",
      )}
    >
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
      <span className="mono font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

/**
 * Fresher Sprint top-bar clock on server time: countdown to the bell, the
 * game clock, and the next listing / coupon / final-phase moments.
 */
export function FresherClock({
  challenge,
}: {
  challenge: Pick<Challenge, "startsAt" | "endsAt" | "config" | "status">;
}) {
  const now = useServerNow(500);
  const fc = fresherClock(challenge, now);
  if (!fc) return null;
  const { phase } = fc;
  const duration = scriptDurationMinutes(fc.script) * 60;
  const ended = challenge.status === "ended" || phase.ended;

  if (!phase.started)
    return (
      <div className="flex items-center gap-2">
        <Chip
          label="Opening bell in"
          value={clock(fc.msUntil(0))}
          tone="accent"
        />
      </div>
    );
  if (ended)
    return (
      <div className="flex items-center gap-2">
        <Chip label="Closing bell" value="Market closed" />
      </div>
    );

  const remainingMs = fc.msUntil(duration);
  const nextCoupon = phase.nextCoupon;
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
      <Chip label="Game clock" value={gameClockLabel(phase.second)} />
      <Chip
        label="Closing bell in"
        value={clock(remainingMs)}
        tone={remainingMs <= 5 * fc.minuteMs ? "warn" : "default"}
      />
      {phase.paused && (
        <Chip label="Paused" value={clock(fc.msUntil(1515))} tone="warn" />
      )}
      {!phase.paused && phase.finalPhase && (
        <Chip label="Final phase" value="Manage your risk" tone="warn" />
      )}
      {phase.nextListing && (
        <Chip
          label={`${phase.nextListing.symbol} lists in`}
          value={clock(fc.msUntil(phase.nextListing.atSecond))}
          tone="accent"
        />
      )}
      {nextCoupon && nextCoupon.index < FRESHER_BOND_COUPON_SECONDS.length && (
        <Chip
          label={`Coupon ${nextCoupon.index + 1} in`}
          value={clock(fc.msUntil(nextCoupon.atSecond))}
        />
      )}
    </div>
  );
}
