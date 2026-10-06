import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fresher Sprint | Quant Club IIT Bombay",
  description:
    "Log in to the Fresher Sprint live trading simulation by Quant Club, IIT Bombay.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
