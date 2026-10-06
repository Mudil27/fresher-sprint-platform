import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trading floor | Fresher Sprint",
  description:
    "Fresher Sprint events by Quant Club, IIT Bombay: a 30-minute live trading simulation.",
};

export default function ChallengesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
