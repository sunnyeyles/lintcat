import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pr-review/design"],
  // Rewrites barrel imports to deep ones so a page pulls only the components it names.
  experimental: {
    optimizePackageImports: ["@pr-review/design", "lucide-react", "recharts"],
  },
  async redirects() {
    return [{ source: "/docs/trust-boundary", destination: "/docs/security", permanent: true }];
  },
};

export default nextConfig;
