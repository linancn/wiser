import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  rewrites() {
    const configured = process.env.AGENT_EXCON_API_INTERNAL_URL;
    if (configured === undefined || configured.length === 0) return [];
    try {
      const api = new URL(configured);
      if (api.protocol !== 'http:' && api.protocol !== 'https:') return [];
      return ['v1', 'v2'].map((version) => ({
        source: `/api/${version}/:path*`,
        destination: `${api.origin}/api/${version}/:path*`,
      }));
    } catch {
      return [];
    }
  },
};

export default nextConfig;
