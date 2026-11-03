import type { NextConfig } from "next";

// Content-Security-Policy for the production build (the dev server needs eval for
// hot reload). Next.js hydrates with inline scripts, hence 'unsafe-inline' for
// scripts; everything else is limited to this origin plus the OpenStreetMap tiles
// the map draws. Recortes and video come through this origin's own /api routes.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "connect-src 'self' https://tile.openstreetmap.org",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone) so the Docker image ships only the
  // traced files instead of the whole node_modules.
  output: "standalone",
  poweredByHeader: false,
  // Use the compiler API so builds also work in restricted environments where
  // Next.js cannot spawn the TypeScript CLI as a child process.
  experimental: {
    useTypeScriptCli: false,
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
