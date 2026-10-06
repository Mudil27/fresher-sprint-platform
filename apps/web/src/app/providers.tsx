"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { NEXT_KEY } from "@/lib/next-path";

/** The only routes reachable without signing in. */
const isPublic = (path: string) =>
  path === "/login" || path.startsWith("/login/");

export function Providers({ children }: { children: React.ReactNode }) {
  const hydrate = useAuth((s) => s.hydrate);
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const pathname = usePathname();
  const router = useRouter();
  const publicRoute = isPublic(pathname);
  const blocked = !publicRoute && !user;

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!blocked || loading) return;
    const next = `${pathname}${window.location.search}`;
    try {
      window.sessionStorage.setItem(NEXT_KEY, next);
    } catch {
      // storage blocked: user lands on the desk after sign-in
    }
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [blocked, loading, pathname, router]);

  if (blocked)
    return (
      <main id="main" className="grid min-h-dvh place-items-center bg-bg">
        <p role="status" className="mono text-sm text-muted">
          {loading ? "Loading..." : "Redirecting to login..."}
        </p>
      </main>
    );
  return <>{children}</>;
}
