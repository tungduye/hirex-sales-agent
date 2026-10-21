import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.HIREX_BUILD_DIR || ".next",
  // Mutable bridge state is read from the host at runtime, never bundled.
  outputFileTracingExcludes: { "/*": ["./runtime/**/*", "./playwright/.auth/**/*"] },
  // Files sent into Zalo chats are uploaded through /api/inbox/.../attachments (up to 25 MB); the proxy
  // (src/proxy.ts) runs on that route too and would otherwise cut request bodies at 10 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" }, proxyClientMaxBodySize: "26mb" },
  // Bản xem trước moduleHS (next dev cổng 3005): mở qua app2.hirexmkt.online, tienich.hat11.io.vn hoặc IP nội bộ.
  allowedDevOrigins: ["127.0.0.1", "app.hirexmkt.online", "app2.hirexmkt.online", "tienich.hat11.io.vn", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
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
