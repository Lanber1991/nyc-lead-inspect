/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      '/api/generate-report': ['./public/**/*'],
      '/api/report-pdf/[id]': ['./public/**/*'],
    },
  },
}

module.exports = nextConfig
