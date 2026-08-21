import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  output: 'export',
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default withMDX(nextConfig);
