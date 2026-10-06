/**
 * Public endpoints. Leave NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL unset (or
 * set to "relative") when web, /api and /ws sit behind one reverse proxy: the
 * browser then calls the origin it loaded the page from, so a single build
 * works on the LAN address and the Cloudflare tunnel domain alike.
 */
const configuredApi = process.env.NEXT_PUBLIC_API_URL;
const configuredWs = process.env.NEXT_PUBLIC_WS_URL;

const isRelative = (v: string | undefined) => !v || v === "relative";

/** Base for REST calls; "" means same origin. */
export const API_URL = isRelative(configuredApi) ? "" : configuredApi!;

/** Base for the WebSocket; derived from the page origin when relative. */
export function wsBaseUrl(): string {
  if (!isRelative(configuredWs)) return configuredWs!;
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export const TOKEN_KEY = "qtp.token";
