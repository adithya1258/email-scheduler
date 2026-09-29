import type { NextConfig } from 'next';

// On Vercel without a backend URL, default to the in-browser demo backend.
const demoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE ?? (process.env.VERCEL && !process.env.NEXT_PUBLIC_API_URL ? 'true' : 'false');

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (ignored by Vercel).
  output: 'standalone',
  env: { NEXT_PUBLIC_DEMO_MODE: demoMode },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }],
  },
};

export default nextConfig;
