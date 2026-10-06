"use client";

import { useEffect, useState } from "react";
import { API_URL } from "./config";

/**
 * Server clock. Laptops in a hall can be seconds off, so every countdown is
 * driven by server time: the offset is the API's timestamp minus the local
 * clock at the midpoint of the request, refreshed every few minutes.
 */
let offsetMs = 0;
let lastSync = 0;
let syncing: Promise<void> | null = null;

async function syncOnce(): Promise<void> {
  const samples: Array<{ rtt: number; offset: number }> = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${API_URL}/api/health`, { cache: "no-store" });
      const body = (await res.json()) as { ts?: number };
      const t1 = Date.now();
      if (typeof body.ts === "number")
        samples.push({ rtt: t1 - t0, offset: body.ts - (t0 + t1) / 2 });
    } catch {
      /* keep the previous offset */
    }
  }
  if (samples.length === 0) return;
  // The fastest round trip has the least network asymmetry.
  samples.sort((a, b) => a.rtt - b.rtt);
  offsetMs = samples[0]!.offset;
  lastSync = Date.now();
}

function ensureSync(): void {
  if (syncing || Date.now() - lastSync < 5 * 60_000) return;
  syncing = syncOnce().finally(() => {
    syncing = null;
  });
}

/** Current server time in epoch ms (best estimate). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Re-renders every `tickMs` with the server time. */
export function useServerNow(tickMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    ensureSync();
    const t = setInterval(() => {
      ensureSync();
      setNow(serverNow());
    }, tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}
