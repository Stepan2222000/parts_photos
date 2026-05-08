/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.PHOTOS_API_BASE || 'http://localhost:8001'}/:path*` },
    ];
  },
};

module.exports = nextConfig;
