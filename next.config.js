/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required. Keeps the Docker image small (standalone bundles only traced
  // files) instead of shipping the whole node_modules tree. See SPEC.md §10.1.
  // Do not remove.
  output: 'standalone',

  // Pin the workspace root. Without this, an unrelated lockfile in a parent
  // directory makes Next infer the wrong root, which puts the wrong files in
  // the standalone bundle.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
};

module.exports = nextConfig;
