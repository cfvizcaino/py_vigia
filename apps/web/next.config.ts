import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use the compiler API so builds also work in restricted environments where
  // Next.js cannot spawn the TypeScript CLI as a child process.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
