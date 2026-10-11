import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone) so the Docker image ships only the
  // traced files instead of the whole node_modules.
  output: "standalone",
  // Use the compiler API so builds also work in restricted environments where
  // Next.js cannot spawn the TypeScript CLI as a child process.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
