import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client"],
  logging: { fetches: { fullUrl: false } },
};

export default nextConfig;
