import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as const,
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022' as const,
  outExtension: ({ format }: { format: string }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
};

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: true,
  },
  {
    ...shared,
    entry: { 'react/index': 'src/react/index.tsx' },
    clean: false,
    // tsup's treeshake pass runs through rollup, which strips module-level
    // directives and would drop the banner below along with them.
    treeshake: false,
    // React stays a peer dependency: the server entry must never bundle it.
    external: ['react'],
    // The bundler strips module-level directives, but Next.js App Router needs
    // this one to survive or the component is treated as a server component.
    banner: { js: `'use client';` },
  },
]);
