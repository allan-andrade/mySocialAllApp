import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS resolves constructor DI from TS decorator metadata (`design:paramtypes`),
  // which Vite's default esbuild transform does not emit. swc does, via `.swcrc`.
  // `.swcrc` sets `module.type: "commonjs"` for `nest build`; override it to `es6`
  // here so Vite's own ESM runtime (which Vitest itself is loaded through) is untouched.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    globals: false,
  },
});
