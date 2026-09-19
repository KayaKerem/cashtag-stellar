import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace paketleri derlenmeden src/index.ts olarak export ediliyor
  transpilePackages: ["@cliprail/shared", "@cliprail/client"],
};

export default nextConfig;
