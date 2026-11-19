import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['googleapis'],
  // Strict TypeScript is checked by `npm run lint`; avoid a duplicate
  // low-memory type-check worker during `next build` on small build machines.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
