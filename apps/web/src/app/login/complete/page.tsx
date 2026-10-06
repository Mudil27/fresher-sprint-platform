"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { NEXT_KEY, safeNextPath } from "@/lib/next-path";

/** Landing page for the API's SSO callback: #token=<jwt>. */
export default function LoginCompletePage() {
  const router = useRouter();
  const completeSso = useAuth((s) => s.completeSso);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    // Drop the token from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      router.replace("/login?error=sso_missing_key");
      return;
    }
    let next = "/challenges";
    try {
      next = safeNextPath(window.sessionStorage.getItem(NEXT_KEY));
      window.sessionStorage.removeItem(NEXT_KEY);
    } catch {
      // storage blocked: default destination
    }
    completeSso(token).then(
      () => router.replace(next),
      () => setFailed(true),
    );
  }, [completeSso, router]);

  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-bg px-6">
      {failed ? (
        <p role="alert" className="text-sm text-down">
          Sign-in failed.{" "}
          <a href="/login" className="underline">
            Try again
          </a>
        </p>
      ) : (
        <p role="status" className="mono text-sm text-muted">
          Signing you in...
        </p>
      )}
    </main>
  );
}
