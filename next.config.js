/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required. Keeps the Docker image small (standalone bundles only traced
  // files) instead of shipping the whole node_modules tree. See SPEC.md §10.1.
  // Do not remove.
  output: 'standalone',

  // Pin the workspace root. Without this, an unrelated lockfile in a parent
  // directory makes Next infer the wrong root, which puts the wrong files in
  // the standalone bundle.
  // Server actions cap request bodies at 1MB by default, which is below the 5MB
  // upload cap in SPEC.md §9.3 — without this, an oversized upload dies with a
  // 413 before lib/images.ts can return a readable rejection. 6MB leaves room
  // for multipart overhead on a 5MB image.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },

  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,

  // TEMPORARY — SPEC.md §16, the Cloudflare Workers demo. Remove with that
  // phase.
  //
  // `pg` reaches Postgres from a Worker through pg-cloudflare, whose real
  // implementation sits behind the `workerd` export condition. Next's file
  // tracer only follows the `default` condition, which points at dist/empty.js,
  // so without this the traced bundle contains the stub and the Worker build
  // fails to resolve dist/index.js. Harmless on the container path: it copies
  // two files nothing there imports.
  outputFileTracingIncludes: {
    '**': ['./node_modules/pg-cloudflare/dist/**', './node_modules/pg-cloudflare/esm/**'],
  },
};

module.exports = nextConfig;
