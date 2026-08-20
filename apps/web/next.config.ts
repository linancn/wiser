import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  rewrites() {
    const api = process.env.AGENT_EXCON_API_INTERNAL_URL;
    if (api === undefined || api.length === 0) return [];
    return [
      {
        source: '/api/v1/:path*',
        destination: `${api.replace(/\/$/, '')}/:path*`,
      },
    ];
  },
};

export default nextConfig;
