/** @type {import('next').NextConfig} */
const nextConfig = {
  skipTrailingSlashRedirect: true,

  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ]
  },

  async headers() {
    const allowedOrigins = [
      'http://localhost:5173',
    ]
    const origin = process.env.OPERATOR_REACT_ORIGIN || ''
    if (origin) allowedOrigins.push(origin)

    return [
      {
        source: '/api/operator/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigins.join(',') },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ]
  },
}

module.exports = nextConfig