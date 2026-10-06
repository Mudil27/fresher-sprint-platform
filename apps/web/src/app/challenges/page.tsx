"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import {
  FRESHER_BOND_CLOSE_SECOND,
  FRESHER_BOND_OPEN_SECOND,
  FRESHER_DURATION_MINUTES,
  FRESHER_INSTRUMENTS,
  gameClockLabel,
  isFresherEden,
  type Challenge,
  type ChallengeStatus,
} from "@qtp/shared";
import { get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TopBar } from "@/components/TopBar";
import { ClubBrand } from "@/components/ClubBrand";
import { ChallengeCard } from "@/components/ChallengeCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

const filters: { value: "all" | ChallengeStatus; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "live", label: "Live" },
  { value: "scheduled", label: "Scheduled" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
  { value: "draft", label: "Draft" },
];

const etf = FRESHER_INSTRUMENTS.find((i) => i.kind === "etf");

const format = [
  [
    `${FRESHER_INSTRUMENTS.length} instruments`,
    "Introduced progressively, a new listing every 5 minutes.",
  ],
  ["News", "One headline every minute. Some move prices, some do not."],
  [
    "Bond window",
    `${gameClockLabel(FRESHER_BOND_OPEN_SECOND)} to ${gameClockLabel(FRESHER_BOND_CLOSE_SECOND)}. Fixed coupons, principal back at maturity.`,
  ],
  [
    `${etf?.name ?? "Market-X"} ETF`,
    `Lists at ${gameClockLabel((etf?.listMinute ?? 20) * 60)}, tracking a basket of AERIUM and NEURO.`,
  ],
  [
    "Final settlement",
    `${gameClockLabel(FRESHER_DURATION_MINUTES * 60)}. Positions are marked and the final rankings revealed.`,
  ],
] as const;

const statusOrder: Record<ChallengeStatus, number> = {
  live: 0,
  scheduled: 1,
  paused: 2,
  draft: 3,
  ended: 4,
};

export default function ChallengesPage() {
  const { user, loading: authLoading } = useAuth();
  const [allChallenges, setChallenges] = useState<Challenge[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ChallengeStatus>("all");

  useEffect(() => {
    let active = true;
    get<Challenge[]>("/api/challenges")
      .then((data) => {
        if (active) setChallenges(data);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  // Participants see only the Fresher events; admins see everything.
  const challenges =
    allChallenges && !authLoading
      ? user?.role === "admin"
        ? allChallenges
        : allChallenges.filter((c) => isFresherEden(c.config.eden))
      : null;

  const search = query.trim().toLowerCase();
  const visible = (challenges ?? [])
    .filter((challenge) => {
      const text = [
        challenge.name,
        challenge.description,
        challenge.type.replaceAll("_", " "),
        ...challenge.config.symbols.map(
          (symbol) => `${symbol.symbol} ${symbol.name ?? ""}`,
        ),
      ].join(" ");
      return (
        (status === "all" || challenge.status === status) &&
        text.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  const liveCount =
    challenges?.filter((challenge) => challenge.status === "live").length ?? 0;
  const entries =
    challenges?.reduce(
      (sum, challenge) => sum + (challenge.participantCount ?? 0),
      0,
    ) ?? 0;

  return (
    <div className="min-h-dvh bg-bg">
      <TopBar brand={<ClubBrand />} deskLabel="Trading floor" />
      <main
        id="main"
        className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-12"
      >
        <header className="border-b border-border pb-8">
          <p className="mono mb-4 text-xs uppercase tracking-[0.16em] text-muted">
            Fresher Sprint / Trading desk
          </p>
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                The trading floor
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
                Find your market. Test your strategy. Trade against the field.
              </p>
            </div>
            {challenges && (
              <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <dt className="text-muted">Live</dt>
                  <dd
                    className={cn(
                      "mono font-medium",
                      liveCount > 0 && "text-up",
                    )}
                  >
                    {liveCount}
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-muted">Events</dt>
                  <dd className="mono font-medium">{challenges.length}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-muted">Total entries</dt>
                  <dd className="mono font-medium">
                    {entries.toLocaleString("en-US")}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </header>

        <div className="mt-8 grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_250px] xl:gap-12">
          <section aria-labelledby="events-heading" className="min-w-0">
            <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <h2
                id="events-heading"
                className="text-lg font-semibold tracking-tight"
              >
                Event directory
              </h2>
              <div className="relative w-full sm:max-w-xs">
                <label htmlFor="event-search" className="sr-only">
                  Search events, formats or symbols
                </label>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-3 size-4 text-muted"
                />
                <Input
                  id="event-search"
                  type="search"
                  placeholder="Search events or symbols"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-10 pl-9"
                />
              </div>
            </div>

            <div
              role="group"
              aria-label="Filter events by status"
              className="mb-5 flex flex-wrap gap-1"
            >
              {filters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={status === filter.value}
                  onClick={() => setStatus(filter.value)}
                  className={cn(
                    "min-h-10 rounded-sm px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                    status === filter.value
                      ? "bg-surface-3 text-text"
                      : "text-muted hover:bg-surface hover:text-text",
                  )}
                >
                  {filter.value === "live" && (
                    <span
                      aria-hidden="true"
                      className="mr-1.5 inline-block size-1.5 rounded-full bg-up"
                    />
                  )}
                  {filter.label}
                  {challenges && (
                    <span
                      className={cn(
                        "mono ml-2",
                        status === filter.value ? "text-accent" : "text-faint",
                      )}
                    >
                      {filter.value === "all"
                        ? challenges.length
                        : challenges.filter(
                            (challenge) => challenge.status === filter.value,
                          ).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {error ? (
              <div role="alert" className="border-y border-border py-10">
                <h3 className="font-medium">Events could not be loaded</h3>
                <p className="mb-4 mt-2 text-sm text-muted">
                  Check your connection and try again.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setError(false);
                    setAttempt((value) => value + 1);
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : !challenges ? (
              <div
                role="status"
                aria-label="Loading events"
                className="space-y-3 border-t border-border pt-4"
              >
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-36 rounded-sm" />
                ))}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-xs text-muted">
                  <p role="status">
                    {visible.length} {visible.length === 1 ? "event" : "events"}
                    {search || status !== "all" ? " found" : " listed"}
                  </p>
                  <span className="mono text-[10px] uppercase tracking-wider">
                    Live first / Times in IST
                  </span>
                </div>
                {visible.length > 0 ? (
                  <ul className="divide-y divide-border border-b border-border">
                    {visible.map((challenge) => (
                      <li key={challenge.id}>
                        <ChallengeCard challenge={challenge} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="border-b border-border py-12">
                    <h3 className="text-lg font-medium">
                      {challenges.length
                        ? "No matching events"
                        : "The next session is still ahead"}
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      {challenges.length
                        ? "Try another name, symbol or status."
                        : "Events will appear here when an organizer publishes them."}
                    </p>
                    {challenges.length > 0 && (
                      <Button
                        variant="secondary"
                        className="mt-5"
                        onClick={() => {
                          setQuery("");
                          setStatus("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <aside
            aria-labelledby="formats-heading"
            className="border-t border-border pt-6 xl:pt-5"
          >
            <div className="flex items-center justify-between">
              <h2
                id="formats-heading"
                className="mono text-xs uppercase tracking-wider text-muted"
              >
                Fresher Sprint format
              </h2>
              <ArrowUpRight aria-hidden="true" className="size-4 text-faint" />
            </div>
            <dl className="mt-6 space-y-6">
              {format.map(([title, text]) => (
                <div key={title}>
                  <dt className="text-sm font-semibold">{title}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted">
                    {text}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-8 border-t border-border pt-5">
              <h3 className="text-sm font-medium">First time on the desk?</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Open an event to explore its market. Sign in to trade. Your
                first order enrolls you automatically.
              </p>
              <p className="mono mt-5 text-[10px] uppercase tracking-wider text-faint">
                Virtual money · Live market · 30 minutes
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
