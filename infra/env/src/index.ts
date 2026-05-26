/**
 * @mog/env — cross-runtime environment detection.
 *
 * Single source of truth for `isDev`/`isProd`/`isTest`/`getEnvVar` across
 * Vite-bundled browser packages (reads `import.meta.env`) and Node/Jest
 * (falls back to `process.env`).
 *
 * This is the only module in the monorepo allowed to touch `process`
 * and `import.meta.env` directly — every other browser-target call site
 * imports the helpers from here. That keeps `@types/node` out of
 * browser-only package.json files.
 */

type ViteEnv = {
  DEV?: boolean;
  PROD?: boolean;
  MODE?: string;
} & Record<string, string | boolean | undefined>;

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

// `import.meta.env` is a Vite-injected object. Under Jest/ts-jest in CJS mode
// `import.meta` is undefined at runtime — guard before dereferencing.
const _viteEnv: ViteEnv | undefined =
  typeof import.meta !== 'undefined'
    ? (import.meta as unknown as { env?: ViteEnv }).env
    : undefined;

// Read `process` off `globalThis` rather than as a bare identifier — avoids
// requiring `@types/node` in this package or any consumer.
const _process: ProcessLike | undefined = (globalThis as { process?: ProcessLike }).process;

export function isDev(): boolean {
  if (_viteEnv && typeof _viteEnv.DEV === 'boolean') return _viteEnv.DEV;
  return _process?.env?.NODE_ENV === 'development';
}

export function isProd(): boolean {
  if (_viteEnv && typeof _viteEnv.PROD === 'boolean') return _viteEnv.PROD;
  return _process?.env?.NODE_ENV === 'production';
}

export function isTest(): boolean {
  if (_viteEnv && typeof _viteEnv.MODE === 'string') return _viteEnv.MODE === 'test';
  return _process?.env?.NODE_ENV === 'test';
}

export function getEnvVar(key: string): string | undefined {
  const fromVite = _viteEnv?.[key];
  if (typeof fromVite === 'string') return fromVite;
  return _process?.env?.[key];
}
