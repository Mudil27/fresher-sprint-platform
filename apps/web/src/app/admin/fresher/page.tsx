"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FRESHER_BOND_DEFAULTS,
  type AdminCueSheet,
  type Challenge,
} from "@qtp/shared";
import { ApiError, get, post } from "@/lib/api";
import { API_URL, TOKEN_KEY } from "@/lib/config";
import { TopBar } from "@/components/TopBar";
import { AdminGuard } from "@/components/AdminGuard";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

type Script = "fresher-v1" | "warmup-v1";
type Bots = "none" | "passive" | "active";

const SLUG: Record<Script, string> = {
  "fresher-v1": "fresher-sprint",
  "warmup-v1": "fresher-warm-up",
};
const TITLE: Record<Script, string> = {
  "fresher-v1": "Fresher Sprint (30 min)",
  "warmup-v1": "Warm-up (5 min)",
};

function errorText(err: unknown): string {
  const code =
    err instanceof ApiError
      ? (err.body as { error?: string })?.error
      : undefined;
  switch (code) {
    case "challenge_in_progress":
      return "This challenge has started or ended. Reset it (test runs only) before scheduling again.";
    case "invalid_bond_terms":
      return "Minimum principal must not exceed the maximum.";
    case "cue_blocked":
      return "Fire the earlier beat first.";
    case "cue_already_run":
      return "That beat already ran.";
    case "challenge_not_live":
      return "The challenge is not live.";
    default:
      return code ? `Request failed: ${code}` : "Request failed.";
  }
}

/** ISO string to the value a datetime-local input expects (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function download(path: string, fallbackName: string): Promise<void> {
  const token = window.localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok)
    throw new ApiError(res.status, await res.json().catch(() => null));
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download =
    /filename="([^"]+)"/.exec(
      res.headers.get("content-disposition") ?? "",
    )?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Timeline({ challenge }: { challenge: Challenge }) {
  const [sheet, setSheet] = useState<AdminCueSheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSheet(await get<AdminCueSheet>(`/api/admin/${challenge.id}/cues`));
    } catch {
      /* keep the last sheet */
    }
  }, [challenge.id]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  async function setMode(manual: boolean) {
    if (
      manual &&
      !confirm(
        "Switch to host-fired beats? The automatic schedule AND the automatic closing bell stop until you switch back. Trading continues.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/admin/${challenge.id}/script-mode`, { manual });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function fire(cueId: string) {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/admin/${challenge.id}/cues/run`, { cueId });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!sheet)
    return <p className="px-3 py-4 text-xs text-muted">Loading timeline…</p>;
  const next = sheet.cues.find((c) => c.status === "ready");
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Schedule:</span>
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 font-semibold",
            sheet.manual
              ? "bg-warning/15 text-warning"
              : "bg-up-subtle text-up",
          )}
        >
          {sheet.manual ? "Manual (host-fired)" : "Automatic"}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => setMode(!sheet.manual)}
        >
          {sheet.manual
            ? "Resume automatic schedule"
            : "Switch to host-fired fallback"}
        </Button>
        {sheet.manual && next && (
          <Button
            size="sm"
            disabled={busy || challenge.status !== "live"}
            onClick={() => fire(next.id)}
          >
            Fire next beat: {next.label}
          </Button>
        )}
      </div>
      {sheet.manual && (
        <p className="text-xs text-warning">
          The closing bell will not ring automatically while in manual mode.
          Fire the 30:00 beat, or resume the automatic schedule (due beats then
          catch up immediately).
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-down">
          {error}
        </p>
      )}
      <ol className="max-h-[420px] divide-y divide-border overflow-y-auto rounded-md border border-border">
        {sheet.cues.map((cue) => (
          <li key={cue.id} className="flex items-start gap-3 px-3 py-2 text-xs">
            <span
              className={cn(
                "mt-0.5 w-16 shrink-0 rounded-sm px-1 text-center text-[10px] font-semibold uppercase",
                cue.status === "done"
                  ? "bg-up-subtle text-up"
                  : cue.status === "ready"
                    ? "bg-accent-subtle text-accent"
                    : cue.status === "running"
                      ? "bg-warning/15 text-warning"
                      : "bg-surface-3 text-faint",
              )}
            >
              {cue.status}
            </span>
            <div className="min-w-0 flex-1">
              <p className="mono text-text">{cue.label}</p>
              {cue.headlines.map((h) => (
                <p key={h.minute} className="mt-0.5 text-muted">
                  <span className="mr-1 rounded-sm border border-border px-1 text-[10px] uppercase">
                    {h.classification}
                  </span>
                  {h.text}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ScriptCard({
  script,
  challenge,
  onSaved,
}: {
  script: Script;
  challenge: Challenge | null;
  onSaved: () => void;
}) {
  const bond = challenge?.config.eden?.fresherBond;
  const currentBots: Bots =
    (challenge?.config.eden?.bots?.hftMarketMakers ?? 2) === 0
      ? "none"
      : (challenge?.config.eden?.bots?.momentumTraders ?? 0) > 0
        ? "active"
        : "passive";
  const [startsAt, setStartsAt] = useState(
    toLocalInput(challenge?.startsAt ?? null),
  );
  const [bots, setBots] = useState<Bots>(currentBots);
  const [totalReturn, setTotalReturn] = useState(
    String(bond?.totalReturn ?? FRESHER_BOND_DEFAULTS.totalReturn),
  );
  const [minPrincipal, setMinPrincipal] = useState(
    String(bond?.minPrincipal ?? FRESHER_BOND_DEFAULTS.minPrincipal),
  );
  const [maxPrincipal, setMaxPrincipal] = useState(
    String(bond?.maxPrincipal ?? FRESHER_BOND_DEFAULTS.maxPrincipal),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState("");

  async function save() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await post("/api/admin/fresher", {
        script,
        bots,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        ...(script === "fresher-v1"
          ? {
              bondTerms: {
                totalReturn: Number(totalReturn),
                minPrincipal: Number(minPrincipal),
                maxPrincipal: Number(maxPrincipal),
              },
            }
          : {}),
      });
      setMsg(
        startsAt
          ? "Saved and scheduled. The engine opens the market at the start time."
          : "Saved as a draft.",
      );
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!challenge || confirmReset !== "RESET") return;
    setBusy(true);
    setError(null);
    try {
      if (challenge.status === "live")
        await post(`/api/challenges/${challenge.id}/status`, {
          status: "paused",
        });
      await post(`/api/admin/${challenge.id}/reset`, {});
      setConfirmReset("");
      setMsg(
        "Reset: orders, trades, positions, news and bonds cleared; the challenge is a draft again.",
      );
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(kind: "rankings" | "trades" | "headlines") {
    if (!challenge) return;
    setError(null);
    try {
      await download(
        `/api/admin/export/${challenge.id}/${kind}.csv`,
        `${SLUG[script]}-${kind}.csv`,
      );
    } catch (err) {
      setError(errorText(err));
    }
  }

  const editable =
    !challenge ||
    challenge.status === "draft" ||
    challenge.status === "scheduled";
  return (
    <Panel className="min-w-0 overflow-hidden">
      <PanelHeader title={TITLE[script]}>
        {challenge && <StatusBadge status={challenge.status} />}
      </PanelHeader>
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">
            Opening bell (your local time)
            <Input
              type="datetime-local"
              value={startsAt}
              disabled={!editable}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-muted">
            Liquidity bots
            <Select
              value={bots}
              disabled={!editable}
              onChange={(e) => setBots(e.target.value as Bots)}
              className="mt-1"
            >
              <option value="passive">Passive market makers (default)</option>
              <option value="none">None (players only)</option>
              <option value="active">Active (market makers + momentum)</option>
            </Select>
          </label>
          {script === "fresher-v1" && (
            <>
              <label className="text-xs text-muted">
                Bond total return (× principal for a 10:00 buyer)
                <Input
                  type="number"
                  step="0.05"
                  min="1"
                  value={totalReturn}
                  disabled={!editable}
                  onChange={(e) => setTotalReturn(e.target.value)}
                  className="mt-1"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted">
                  Min principal
                  <Input
                    type="number"
                    step="500"
                    value={minPrincipal}
                    disabled={!editable}
                    onChange={(e) => setMinPrincipal(e.target.value)}
                    className="mt-1"
                  />
                </label>
                <label className="text-xs text-muted">
                  Max principal
                  <Input
                    type="number"
                    step="500"
                    value={maxPrincipal}
                    disabled={!editable}
                    onChange={(e) => setMaxPrincipal(e.target.value)}
                    className="mt-1"
                  />
                </label>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={busy || !editable}>
            {challenge ? "Save & schedule" : "Create & schedule"}
          </Button>
          {challenge && (
            <>
              <Link
                className="text-xs text-accent underline"
                href={`/challenges/${challenge.id}`}
              >
                Trader view
              </Link>
              <Link
                className="text-xs text-accent underline"
                href={`/admin/${challenge.id}`}
              >
                Live operations (pause, rankings, rewind)
              </Link>
              <Link
                className="text-xs text-accent underline"
                href={`/admin/${challenge.id}/stats`}
              >
                Projector
              </Link>
            </>
          )}
        </div>
        {!editable && (
          <p className="text-xs text-faint">
            Settings are locked once the challenge has started.
          </p>
        )}
        {msg && <p className="text-xs text-up">{msg}</p>}
        {error && (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        )}

        {challenge &&
          (challenge.status === "live" ||
            challenge.status === "ended" ||
            challenge.status === "paused") && (
            <div className="rounded-md border border-border">
              <h3 className="border-b border-border px-3 py-2 text-xs font-medium text-muted">
                Timeline
              </h3>
              <Timeline challenge={challenge} />
            </div>
          )}

        {challenge && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted">Export CSV:</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => exportCsv("rankings")}
            >
              Rankings
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => exportCsv("trades")}
            >
              Trades
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => exportCsv("headlines")}
            >
              Headline debrief
            </Button>
          </div>
        )}

        {challenge && challenge.status !== "draft" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-xs text-down">
              Reset (test runs only — never on event day):
            </span>
            <Input
              placeholder="type RESET"
              value={confirmReset}
              onChange={(e) => setConfirmReset(e.target.value)}
              className="w-32"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || confirmReset !== "RESET"}
              onClick={reset}
            >
              Reset challenge
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function FresherSetup() {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const load = useCallback(async () => {
    try {
      setChallenges(await get<Challenge[]>("/api/challenges"));
    } catch {
      setChallenges([]);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  const find = (script: Script) =>
    challenges?.find((c) => c.slug === SLUG[script]) ?? null;
  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-lg font-semibold">Fresher Sprint setup</h1>
          <p className="mt-1 text-sm text-muted">
            Schedule the warm-up and the 30-minute game. The schedule runs
            automatically from the opening bell; switch a running game to
            host-fired beats only if the automatic schedule needs to be held.
          </p>
        </div>
        {challenges === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          (["warmup-v1", "fresher-v1"] as const).map((script) => (
            <ScriptCard
              key={`${script}:${find(script)?.id ?? "new"}:${find(script)?.status ?? ""}`}
              script={script}
              challenge={find(script)}
              onSaved={load}
            />
          ))
        )}
      </main>
    </div>
  );
}

export default function FresherSetupPage() {
  return (
    <AdminGuard>
      <FresherSetup />
    </AdminGuard>
  );
}
