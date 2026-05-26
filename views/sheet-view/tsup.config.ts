import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'es2020',
  platform: 'browser',
  outDir: 'dist',
  tsconfig: 'tsconfig.json',
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^@mog\//, /^@mog-sdk\/spreadsheet-contracts(?:\/.*)?$/],
  esbuildOptions(options) {
    options.conditions = ['development'];
  },
});
