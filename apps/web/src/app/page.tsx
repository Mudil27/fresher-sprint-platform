import type { Metadata } from "next";
import Link from "next/link";
import {
  FRESHER_BOND_CLOSE_SECOND,
  FRESHER_BOND_COUPON_SECONDS,
  FRESHER_BOND_DEFAULTS,
  FRESHER_BOND_MATURITY_SECOND,
  FRESHER_BOND_OPEN_SECOND,
  FRESHER_DURATION_MINUTES,
  FRESHER_ETF_BASKET,
  FRESHER_INSTRUMENTS,
  FRESHER_LEADERBOARD_HIDE_SECOND,
  FRESHER_LEADERBOARD_SHOW_SECOND,
  FRESHER_PAUSE_LENGTH_SEC,
  FRESHER_PAUSE_SECOND,
  FRESHER_STARTING_CASH,
  gameClockLabel,
} from "@qtp/shared";
import {
  AdminLink,
  EnterDeskLink,
  HomeHeader,
} from "@/components/home/HomeActions";

export const metadata: Metadata = {
  title: "Fresher Sprint | Quant Club, IIT Bombay",
  description:
    "A 30-minute live trading simulation for IIT Bombay freshers, run by Quant Club.",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const at = gameClockLabel;
const etf = FRESHER_INSTRUMENTS.find((i) => i.kind === "etf");
const coupons = FRESHER_BOND_COUPON_SECONDS.map(at);

const glance = [
  ["Format", `${FRESHER_DURATION_MINUTES}-minute live session`],
  ["Starting cash", `${inr(FRESHER_STARTING_CASH)} (virtual)`],
  ["Instruments", `${FRESHER_INSTRUMENTS.length}, one new listing every 5 minutes`],
  ["News", "One headline every minute"],
  ["Bring", "A charged laptop"],
] as const;

// Session beats, in clock order.
const timeline: { second: number; title: string; text: string }[] = [
  ...FRESHER_INSTRUMENTS.map((i) => ({
    second: i.listMinute * 60,
    title: `${i.symbol} lists`,
    text: `${i.name}. ${i.description}`,
  })),
  {
    second: FRESHER_LEADERBOARD_SHOW_SECOND,
    title: "Leaderboard opens",
    text: "Top 10 and your own rank, updated live.",
  },
  {
    second: FRESHER_BOND_OPEN_SECOND,
    title: "Bond subscription opens",
    text: `Open until ${at(FRESHER_BOND_CLOSE_SECOND)}. Coupons start at ${coupons[0]}.`,
  },
  {
    second: FRESHER_PAUSE_SECOND,
    title: "Final phase",
    text: `A ${FRESHER_PAUSE_LENGTH_SEC}-second pause to read the board, then the leaderboard goes dark until the close.`,
  },
  {
    second: FRESHER_DURATION_MINUTES * 60,
    title: "Closing bell",
    text: "Bond matures, positions are marked, final rankings revealed.",
  },
].sort((a, b) => a.second - b.second);

const desk = [
  [
    "Order book",
    "See every resting bid and ask, live. The best prices sit at the top; the gap between them is the spread.",
  ],
  [
    "Trade ticket",
    "Market orders fill now at the best price on the book. Limit orders wait at your price until someone trades with you.",
  ],
  [
    "News feed",
    "A headline lands every minute. Some matter for an instrument, some are noise. Deciding which is the game.",
  ],
  [
    "Leaderboard",
    `Hidden for the first ${FRESHER_LEADERBOARD_SHOW_SECOND / 60} minutes, live from ${at(FRESHER_LEADERBOARD_SHOW_SECOND)} to ${at(FRESHER_LEADERBOARD_HIDE_SECOND)}, then hidden until the final reveal.`,
  ],
] as const;

const rules = [
  ["Position limit", "Between −100 and +100 units of each instrument. Short selling is allowed within that range."],
  ["Order size", "Up to 25 units per order, and at most 10 open orders at a time."],
  ["No borrowing", "No loans, no leverage, no negative cash. Your open orders and positions must be covered by what you own."],
  ["Clear rejections", "An order that breaks a rule is rejected with the reason shown. It is never quietly cut down."],
  ["Final net worth", "Cash plus every position, marked at the closing mid-price. Bond coupons and principal are already in your cash."],
  ["Ranking", "Highest final net worth wins. The full board is revealed after settlement."],
] as const;

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <HomeHeader />
      <main id="main">
        {/* Hero */}
        <section className="mx-auto max-w-[1440px] px-5 pb-14 pt-12 sm:px-10 lg:pb-20 lg:pt-18">
          <div className="grid items-start gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div>
              <div className="mb-7 flex items-center gap-3">
                <span className="h-px w-8 bg-accent" />
                <p className="mono text-[10px] uppercase tracking-[0.18em] text-muted">
                  Quant Club, IIT Bombay · Fresher orientation
                </p>
              </div>
              <h1 className="landing-title">
                Fresher
                <br />
                <span className="text-muted">Sprint.</span>
              </h1>
              <p className="mt-7 max-w-lg text-base leading-relaxed text-muted">
                A {FRESHER_DURATION_MINUTES}-minute live trading simulation.
                Live order books, virtual money, and every participant trading
                the same market at once. New instruments list as the clock
                runs and a headline drops every minute. No experience needed.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <EnterDeskLink />
                <a href="#rules" className="action-link action-link-secondary">
                  View event rules
                </a>
              </div>
            </div>

            <dl className="overflow-hidden rounded-lg border border-border-strong bg-surface">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-xs font-medium">At a glance</span>
                <span className="mono text-[10px] uppercase tracking-wider text-accent">
                  {FRESHER_DURATION_MINUTES} min
                </span>
              </div>
              {glance.map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[7.5rem_1fr] gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="text-sm">{value}</dd>
                </div>
              ))}
              <div className="bg-surface-2 px-4 py-3 text-[11px] leading-relaxed text-muted">
                No real money is involved. Everything you trade is virtual and
                exists only for this session.
              </div>
            </dl>
          </div>
        </section>

        {/* Timeline */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-[1440px] px-5 py-14 sm:px-10 lg:py-20">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <span className="mono text-xs text-accent">01 / THE CLOCK</span>
                <h2 className="landing-section-title mt-5">
                  Thirty minutes.
                  <br />
                  Five markets.
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-muted">
                The market starts small and grows. Each new listing is a fresh
                chance to get in early.
              </p>
            </div>
            <ol className="mt-10 divide-y divide-border border-y border-border">
              {timeline.map((beat) => (
                <li
                  key={`${beat.second}-${beat.title}`}
                  className="grid gap-1 py-4 sm:grid-cols-[6rem_14rem_1fr] sm:gap-6"
                >
                  <span className="mono text-sm tabular-nums text-accent">
                    {at(beat.second)}
                  </span>
                  <span className="text-sm font-medium">{beat.title}</span>
                  <span className="text-sm leading-relaxed text-muted">
                    {beat.text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The desk */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-10 lg:py-24">
          <span className="mono text-xs text-accent">02 / THE DESK</span>
          <h2 className="landing-section-title mt-5">
            Everything you need
            <br />
            on one screen.
          </h2>
          <div className="mt-10 divide-y divide-border border-y border-border">
            {desk.map(([title, text], i) => (
              <div
                key={title}
                className="grid gap-2 py-6 sm:grid-cols-[8rem_1fr] sm:gap-8"
              >
                <span className="mono text-[10px] text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-base font-medium">{title}</h3>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                    {text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bond and Market-X */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-14 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:py-20">
            <article>
              <span className="mono text-xs text-accent">03 / THE BOND</span>
              <h2 className="mt-5 text-2xl font-medium tracking-tight">
                Lock cash away, get paid back over time.
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
                Between {at(FRESHER_BOND_OPEN_SECOND)} and{" "}
                {at(FRESHER_BOND_CLOSE_SECOND)} you can buy one bond with{" "}
                {inr(FRESHER_BOND_DEFAULTS.minPrincipal)} to{" "}
                {inr(FRESHER_BOND_DEFAULTS.maxPrincipal)}. That cash is locked:
                you cannot trade with it. In return the bond pays fixed coupons
                into your cash and gives the principal back at maturity. Safe
                income, less money to trade with. Your call.
              </p>
              <dl className="mt-6 divide-y divide-border border-y border-border text-sm">
                <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-3">
                  <dt className="text-xs text-muted">Coupons</dt>
                  <dd className="mono tabular-nums">{coupons.join(" · ")}</dd>
                </div>
                <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-3">
                  <dt className="text-xs text-muted">Maturity</dt>
                  <dd className="mono tabular-nums">
                    {at(FRESHER_BOND_MATURITY_SECOND)}
                  </dd>
                </div>
                <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-3">
                  <dt className="text-xs text-muted">Leaderboard</dt>
                  <dd className="text-muted">
                    Locked principal is left out of live rankings until it is
                    returned.
                  </dd>
                </div>
              </dl>
            </article>

            <article>
              <span className="mono text-xs text-accent">04 / MARKET-X</span>
              <h2 className="mt-5 text-2xl font-medium tracking-tight">
                One ticker, two companies.
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
                {etf?.name ?? "Market-X"} is an ETF that lists at{" "}
                {at((etf?.listMinute ?? 20) * 60)}. Its value tracks a basket of{" "}
                {FRESHER_ETF_BASKET.map(
                  (b) => `${Math.round(b.weight * 100)}% ${b.symbol}`,
                ).join(" and ")}
                . It trades on its own order book like any stock, so its price
                can drift above or below what the basket is worth. Spotting
                that gap is the opportunity.
              </p>
            </article>
          </div>
        </section>

        {/* Rules */}
        <section
          id="rules"
          className="mx-auto max-w-[1440px] scroll-mt-20 px-5 py-16 sm:px-10 lg:py-24"
        >
          <span className="mono text-xs text-accent">05 / THE RULES</span>
          <h2 className="landing-section-title mt-5">Event rules.</h2>
          <dl className="mt-10 divide-y divide-border border-y border-border">
            {rules.map(([title, text]) => (
              <div
                key={title}
                className="grid gap-2 py-5 sm:grid-cols-[12rem_1fr] sm:gap-8"
              >
                <dt className="text-sm font-medium">{title}</dt>
                <dd className="max-w-2xl text-sm leading-relaxed text-muted">
                  {text}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Before you arrive */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-8 px-5 py-14 sm:px-10 lg:flex-row lg:items-center lg:py-18">
            <div>
              <h2 className="landing-section-title">Bring a laptop.</h2>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
                The desk is built for a laptop screen: order book, ticket, news
                and rankings side by side. A phone works, but you will see
                less. Charge it, use an up-to-date Chrome, Edge or Firefox, and
                log in a few minutes before the start.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <EnterDeskLink />
              <a href="#rules" className="action-link action-link-secondary">
                View event rules
              </a>
            </div>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-[1440px] flex-col justify-between gap-6 px-5 py-8 sm:flex-row sm:items-center sm:px-10">
        <span className="text-xs text-faint">
          Fresher Sprint · Quant Club, IIT Bombay
        </span>
        <nav aria-label="Footer" className="flex gap-6 text-xs text-muted">
          <a href="#rules" className="hover:text-text">
            Rules
          </a>
          <Link href="/login" className="hover:text-text">
            Log in
          </Link>
          <AdminLink className="hover:text-text" />
        </nav>
      </footer>
    </div>
  );
}
