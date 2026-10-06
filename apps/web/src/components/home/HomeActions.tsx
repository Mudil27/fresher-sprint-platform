"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";

/** Primary entry: straight to the desk when signed in, else to sign-in. */
export function EnterDeskLink({ className }: { className?: string }) {
  const { user } = useAuth();
  return (
    <Link
      href={user ? "/challenges" : "/login"}
      className={cn("action-link", className)}
    >
      {user ? "Enter the trading desk" : "Log in to the trading desk"}
      <ArrowUpRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/** Rendered only for admin accounts. */
export function AdminLink({ className }: { className?: string }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return null;
  return (
    <Link href="/admin/fresher" className={className}>
      Event control
    </Link>
  );
}

export function HomeHeader() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg">
      <div className="mx-auto flex min-h-17 max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-10">
        <Link
          href="/"
          aria-label="Fresher Sprint home"
          className="flex min-w-0 items-baseline gap-2.5"
        >
          <span className="text-[19px] font-semibold tracking-[-0.05em]">
            Quant Club<span className="text-accent">.</span>
          </span>
          <span className="mono hidden text-[10px] uppercase tracking-[0.16em] text-muted sm:inline">
            IIT Bombay
          </span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex items-center gap-5 text-xs text-muted"
        >
          <a href="#rules" className="hidden py-3 hover:text-text sm:inline">
            Rules
          </a>
          <AdminLink className="hidden py-3 hover:text-text sm:inline" />
          {user ? (
            <Link
              href="/challenges"
              className="action-link min-h-9 px-3 sm:px-4"
            >
              Trading desk
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <Link href="/login" className="action-link min-h-9 px-3 sm:px-4">
              Log in <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
