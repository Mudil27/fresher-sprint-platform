import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@qtp/shared"],
  reactStrictMode: true,
  // Hide the Next.js dev badge. The site is public through the tunnel.
  devIndicators: false,
  // Hosts allowed to reach `next dev` from other devices (e.g. the tunnel).
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
  experimental: {
    // Workspace root is the monorepo root.
    externalDir: true,
  },
};

export default nextConfig;
