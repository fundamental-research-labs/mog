/**
 * ESM mock for @mog/transport napi-loader.ts
 *
 * The real napi-loader uses `createRequire(import.meta.url)` which
 * conflicts with Jest's module resolution. This mock provides the same
 * exports using Node's native require via createRequire.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadNapiAddon() {
  return require('@mog/compute-core-napi');
}

export function tryLoadNapiAddon() {
  try {
    return require('@mog/compute-core-napi');
  } catch {
    return undefined;
  }
}

export class AddonNotFoundError extends Error {
  constructor(addonName, message) {
    super(message);
    this.name = 'AddonNotFoundError';
    this.addonName = addonName;
  }
}
