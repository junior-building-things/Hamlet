import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/projects', destination: '/' },
      { source: '/vibe', destination: '/' },
      { source: '/todos', destination: '/' },
      { source: '/chat', destination: '/' },
      { source: '/roles', destination: '/' },
    ];
  },
};

export default nextConfig;
