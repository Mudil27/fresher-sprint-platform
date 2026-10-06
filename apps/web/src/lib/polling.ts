/**
 * REST refresh cadence. While the WebSocket is open it pushes books, prices,
 * fills and portfolios, so REST is only a slow safety net; while it is
 * reconnecting the page falls back to fast polling. At event scale (hundreds
 * of traders) this is the difference between ~1 and ~0.05 requests/s each.
 */
export function pollMs(
  wsStatus: "connecting" | "open" | "closed",
  fastMs: number,
  slowMs = 30_000,
): number {
  return wsStatus === "open" ? slowMs : fastMs;
}
