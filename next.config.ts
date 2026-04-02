import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/projects', destination: '/' },
      { source: '/todos', destination: '/' },
      { source: '/chat', destination: '/' },
    ];
  },
};

export default nextConfig;
