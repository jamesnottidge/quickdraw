import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['@electric-sql/pglite', 'linkedom'],
};

export default nextConfig;
