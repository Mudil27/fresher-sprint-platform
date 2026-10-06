import Link from "next/link";

/** Quant Club, IIT Bombay wordmark for the Fresher Sprint pages. */
export function ClubBrand() {
  return (
    <Link
      href="/"
      aria-label="Fresher Sprint home"
      className="flex min-w-0 shrink-0 items-baseline gap-1.5 text-[16px] font-semibold sm:gap-2 sm:text-[19px] tracking-[-0.05em]"
    >
      Quant Club
      <span className="text-accent">·</span>
      IIT Bombay
    </Link>
  );
}
