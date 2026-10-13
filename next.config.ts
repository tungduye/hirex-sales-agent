import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.HIREX_BUILD_DIR || ".next",
  // Mutable bridge state is read from the host at runtime, never bundled.
  outputFileTracingExcludes: { "/*": ["./runtime/**/*", "./playwright/.auth/**/*"] },
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  allowedDevOrigins: ["127.0.0.1", "app.hirexmkt.online"],
  async headers() {
    return [
      {
        source: "/campaigns/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
