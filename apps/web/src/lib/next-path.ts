/**
 * Same-origin post-login destination. Browsers treat backslashes and // as URL
 * hosts, so anything that is not a plain absolute path falls back to the desk.
 */
export function safeNextPath(requested: string | null | undefined): string {
  const fallback = "/challenges";
  if (
    !requested?.startsWith("/") ||
    requested.startsWith("//") ||
    /[\\\u0000- ]/.test(requested)
  )
    return fallback;
  const destination = new URL(requested, window.location.origin);
  if (
    destination.origin !== window.location.origin ||
    destination.pathname.startsWith("//") ||
    destination.pathname === "/login" ||
    destination.pathname.startsWith("/login/")
  )
    return fallback;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export const NEXT_KEY = "qtp.next";
