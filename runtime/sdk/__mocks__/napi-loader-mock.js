/**
 * Mock for @mog/transport napi-loader.ts
 *
 * The real napi-loader uses `createRequire(import.meta.url)` which doesn't
 * work in Jest's CJS transform mode. This mock provides the same exports
 * using regular require().
 */
function loadNapiAddon() {
  return require('@mog/compute-core-napi');
}

function tryLoadNapiAddon() {
  try {
    return require('@mog/compute-core-napi');
  } catch {
    return undefined;
  }
}

class AddonNotFoundError extends Error {
  constructor(addonName, message) {
    super(message);
    this.name = 'AddonNotFoundError';
    this.addonName = addonName;
  }
}

module.exports = {
  loadNapiAddon,
  tryLoadNapiAddon,
  AddonNotFoundError,
};
