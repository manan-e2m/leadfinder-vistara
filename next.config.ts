import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client"],
  logging: { fetches: { fullUrl: false } },
  webpack: (config) => {
    // `isServer` is true for both nodejs and edge compilations in Next 15;
    // the edge compiler's name is "edge-server".
    if ((config.name ?? "").includes("edge")) {
      // Match every alias shape: tsconfig shorthand, resolved relative, and
      // src-absolute until we find the one that actually lands in the graph.
      const stub = path.resolve(__dirname, "src/lib/startupSweep.edgeStub.ts");
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        "@/lib/startupSweep": stub,
        "@/lib/startupSweep$": stub,
        [path.resolve(__dirname, "src/lib/startupSweep.ts")]: stub,
      };
    }
    return config;
  },
};

export default nextConfig;
