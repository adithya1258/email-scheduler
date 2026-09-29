import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (ignored by Vercel).
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }],
  },
};

export default nextConfig;
