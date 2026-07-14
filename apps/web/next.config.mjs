/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `validation` and `shared` are also consumed by apps/api as plain compiled CommonJS
  // (Node can't run .ts directly), so their package.json "main" points at `dist/`. But
  // pnpm symlinks workspace packages to a real path outside `node_modules`, which makes
  // webpack treat that compiled CJS as first-party app source and drag it into Next's
  // Fast Refresh instrumentation — whose injected `import.meta` then crashes against
  // plain CommonJS output. Both packages additionally set a `"module"` field pointing at
  // their raw TS source; webpack prefers `"module"` over `"main"` for the client bundle,
  // so it compiles the TS source itself via `transpilePackages` (same as `ui`, which has
  // no build step at all) instead of touching the prebuilt CJS. apps/api keeps using
  // `"main"` (dist) unaffected, since plain `require()` never looks at `"module"`.
  transpilePackages: [
    '@social-publisher/ui',
    '@social-publisher/validation',
    '@social-publisher/shared',
    '@social-publisher/social-connectors',
  ],
};

export default nextConfig;
