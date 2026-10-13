import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        // The page has no legitimate iframe navigations. The interactive view is a srcdoc frame (exempt from this
        // directive), and frame-src also governs where a frame may navigate afterwards: an artifact cannot send
        // its own frame to another site, or to this app's own pages.
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "frame-src 'none'" }],
      },
    ];
  },
  serverExternalPackages: ['@electric-sql/pglite', 'linkedom'],
};

export default nextConfig;
