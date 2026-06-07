import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'index.browser': 'src/index.browser.ts', 'index.wasm': 'src/index.wasm.ts' },
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['@mog-sdk/wasm', '@tauri-apps/api', '@tauri-apps/api/core', '@rust-bridge/client'],
  },
  {
    entry: { index: 'src/index.ts' },
    format: 'esm',
    target: 'node18',
    platform: 'node',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    dts: true,
    sourcemap: true,
    external: [
      '@mog/compute-core-napi',
      '@mog-sdk/darwin-arm64',
      '@mog-sdk/darwin-x64',
      '@mog-sdk/linux-x64-musl',
      '@mog-sdk/linux-arm64-musl',
      '@mog-sdk/win32-x64-msvc',
      '@tauri-apps/api',
      '@tauri-apps/api/core',
      '@rust-bridge/client',
      '@mog-sdk/wasm',
      'module',
    ],
  },
]);
