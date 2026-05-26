/**
 * ESM mock for @mog/env.
 *
 * The real module uses `import.meta.env` (Vite-injected) which causes a
 * SyntaxError in Jest's CJS transform mode.
 */

export function isDev() {
  return process.env.NODE_ENV !== 'production';
}

export function isProd() {
  return process.env.NODE_ENV === 'production';
}

export function isTest() {
  return process.env.NODE_ENV === 'test';
}

export function getEnvVar(key) {
  return process.env[key];
}
