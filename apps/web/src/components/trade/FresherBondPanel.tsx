"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";
import {
  FRESHER_BOND_CLOSE_SECOND,
  FRESHER_BOND_COUPON_SECONDS,
  FRESHER_BOND_ID,
  FRESHER_BOND_MATURITY_SECOND,
  FRESHER_BOND_OPEN_SECOND,
  bondCouponAmount,
  fresherBondTemplate,
  gameClockLabel,
  type BondHolding,
  type BondTemplate,
  type Challenge,
  type Portfolio,
} from "@qtp/shared";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError, post } from "@/lib/api";
import { fresherClock } from "@/lib/fresher";
import { useServerNow } from "@/lib/serverClock";
import { money } from "@/lib/format";

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span
        className={strong ? "mono font-semibold text-text" : "mono text-text"}
      >
        {value}
      </span>
    </div>
  );
}

const inr = (n: number) => `INR ${money(n)}`;

function bondError(err: unknown, min: number, max: number): string {
  const code =
    err instanceof ApiError
      ? (err.body as { error?: string })?.error
      : undefined;
  switch (code) {
    case "bond_closed":
      return "The bond subscription window is closed.";
    case "principal_out_of_range":
      return `Invest between ${inr(min)} and ${inr(max)}.`;
    case "bond_limit":
      return "You already hold the bond (one subscription per participant).";
    case "insufficient_cash":
      return "Not enough cash for this amount.";
    case "market_frozen":
      return "Market is paused. Try again when trading resumes.";
    case "challenge_not_live":
      return "Market is closed.";
    default:
      return "Bond subscription failed.";
  }
}

/**
 * Fresher Sprint bond: subscribe once between 10:00 and 20:00, principal is
 * locked until 30:00, coupons every 2.5 minutes are paid to cash. Coupons
 * dated before the purchase are not received.
 */
export function FresherBondPanel({
  challenge,
  templates,
  holdings,
  portfolio,
  frozen,
  onChange,
}: {
  challenge: Pick<
    Challenge,
    "id" | "startsAt" | "endsAt" | "config" | "status"
  >;
  templates: BondTemplate[];
  holdings: BondHolding[];
  portfolio: Portfolio | null;
  frozen: boolean;
  onChange?: () => void;
}) {
  const now = useServerNow(1000);
  const fc = fresherClock(challenge, now);
  const listed = templates.find((t) => t.id === FRESHER_BOND_ID);
  const tpl =
    listed ?? fresherBondTemplate(challenge.config.eden?.fresherBond ?? {});
  const s = tpl.schedule!;
  const holding = holdings.find(
    (h) => h.bondId === FRESHER_BOND_ID && h.quantity > 0,
  );
  const [amount, setAmount] = useState(String(s.minPrincipal));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!fc || fc.script !== "fresher-v1") return null;
  const second = fc.phase.second;
  const open =
    !!listed &&
    !listed.closed &&
    second >= FRESHER_BOND_OPEN_SECOND &&
    second < FRESHER_BOND_CLOSE_SECOND;
  const cash = portfolio?.cash ?? 0;

  async function subscribe() {
    const principal = Number(amount);
    setError(null);
    setNotice(null);
    if (
      !Number.isFinite(principal) ||
      principal < s.minPrincipal ||
      principal > s.maxPrincipal
    ) {
      setError(
        `Invest between ${inr(s.minPrincipal)} and ${inr(s.maxPrincipal)}.`,
      );
      return;
    }
    if (principal > cash) {
      setError("Not enough cash for this amount.");
      return;
    }
    setBusy(true);
    try {
      await post("/api/markets/bonds/purchase", {
        challengeId: challenge.id,
        bondId: FRESHER_BOND_ID,
        price: principal,
      });
      setNotice(
        "Subscription sent. Your principal is locked once it is confirmed.",
      );
      onChange?.();
    } catch (err) {
      setError(bondError(err, s.minPrincipal, s.maxPrincipal));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <PanelHeader
      title={
        <span className="flex items-center gap-1.5">
          <Landmark className="size-3.5" /> Bond
        </span>
      }
    >
      <span className="text-[11px] text-muted">
        {open
          ? `Open until ${gameClockLabel(FRESHER_BOND_CLOSE_SECOND)}`
          : second < FRESHER_BOND_OPEN_SECOND
            ? `Opens at ${gameClockLabel(FRESHER_BOND_OPEN_SECOND)}`
            : "Subscription closed"}
      </span>
    </PanelHeader>
  );

  if (holding) {
    const coupon = bondCouponAmount(s, holding.price);
    // The engine returns the principal at maturity, together with the bell.
    const matured = second >= s.maturitySecond;
    const received = Math.max(
      0,
      holding.couponsPaid - (matured ? holding.price : 0),
    );
    const receivedCount = Math.round(received / coupon);
    const upcoming = s.couponSeconds.filter((c) => c > second);
    const next = upcoming[0];
    const remaining = upcoming.length * coupon + (matured ? 0 : holding.price);
    return (
      <Panel className="flex min-w-0 flex-col overflow-hidden">
        {header}
        <div className="p-3">
          <Row label="Invested principal" value={inr(holding.price)} strong />
          <Row label="Locked cash" value={inr(matured ? 0 : holding.price)} />
          <Row
            label="Coupons received"
            value={`${receivedCount} · ${inr(received)}`}
          />
          <Row
            label="Remaining coupons"
            value={`${upcoming.length} × ${inr(coupon)}`}
          />
          {next != null && (
            <Row
              label="Next coupon"
              value={`${gameClockLabel(next)} · ${inr(coupon)}`}
            />
          )}
          <Row
            label="Maturity"
            value={`${gameClockLabel(s.maturitySecond)} · ${inr(matured ? 0 : holding.price)}`}
          />
          <Row
            label="Expected remaining return"
            value={inr(remaining)}
            strong
          />
          {matured && (
            <p className="mt-2 text-xs text-up">
              Matured: principal returned to your cash.
            </p>
          )}
        </div>
      </Panel>
    );
  }

  const preview = Number(amount);
  const validPreview = Number.isFinite(preview) && preview > 0;
  const remainingDates = FRESHER_BOND_COUPON_SECONDS.filter(
    (c) => c > Math.max(second, FRESHER_BOND_OPEN_SECOND),
  );
  return (
    <Panel className="flex min-w-0 flex-col overflow-hidden">
      {header}
      <div className="space-y-3 p-3">
        <p className="text-xs text-muted">
          One subscription of {inr(s.minPrincipal)} to {inr(s.maxPrincipal)}.
          The principal is locked until{" "}
          {gameClockLabel(FRESHER_BOND_MATURITY_SECOND)} and cannot be used for
          trading. Coupons every 2.5 minutes from{" "}
          {gameClockLabel(s.couponSeconds[0]!)} are paid to your cash; coupons
          dated before you subscribe are missed. A buyer at{" "}
          {gameClockLabel(FRESHER_BOND_OPEN_SECOND)} gets {s.totalReturn}× the
          principal back in total.
        </p>
        {validPreview && (
          <div className="rounded-sm border border-border bg-surface-2 px-3 py-2">
            <Row
              label="Coupons if you subscribe now"
              value={`${remainingDates.length} × ${inr(bondCouponAmount(s, preview))}`}
            />
            <Row
              label="Total back at 30:00"
              value={inr(
                preview + remainingDates.length * bondCouponAmount(s, preview),
              )}
              strong
            />
          </div>
        )}
        {open ? (
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted">
              Principal (INR)
              <Input
                type="number"
                inputMode="numeric"
                min={s.minPrincipal}
                max={Math.min(s.maxPrincipal, Math.floor(cash))}
                step={500}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1"
              />
            </label>
            <Button onClick={subscribe} disabled={busy || frozen}>
              {busy ? "Sending…" : "Subscribe"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-faint">
            {second < FRESHER_BOND_OPEN_SECOND
              ? `Subscriptions open at ${gameClockLabel(FRESHER_BOND_OPEN_SECOND)}.`
              : "Subscriptions are closed."}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        )}
        {notice && <p className="text-xs text-up">{notice}</p>}
      </div>
    </Panel>
  );
}
