import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle, only for the Docker image: building it needs symlinks,
  // which Windows refuses without Developer Mode.
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  // Lint runs as its own Turborepo task.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
