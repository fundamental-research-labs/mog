/**
 * NAPI addon auto-loader — discovers and loads native addons at runtime.
 *
 * Provides both throwing (loadNapiAddon) and silent (tryLoadNapiAddon)
 * variants for different use cases:
 * - SDK consumers that EXPECT napi use loadNapiAddon (throws with instructions)
 * - Transport factory auto-detection uses tryLoadNapiAddon (falls back to WASM)
 *
 * Uses createRequire() so ESM callers can still load native CommonJS addons.
 * Browser builds use index.browser.ts and do not include this module.
 */
import { createRequire } from 'module';
import type { NapiAddon, NapiComputeEngine } from './types';
import { AddonNotFoundError } from './errors';
export { AddonNotFoundError };

/**
 * Create a require function rooted at this ESM module.
 */
function getRequire(): NodeRequire {
  return createRequire(import.meta.url);
}

/**
 * Extended addon module type — includes the ComputeEngine constructor.
 */
export type NapiAddonModule = NapiAddon & {
  ComputeEngine: (new (snapshotJson: string, layoutMetricsJson: string) => NapiComputeEngine) & {
    /** Factory method: create engine from raw Yrs state bytes (collaboration). */
    initFromYrsState?: (state: Buffer, layoutMetricsJson: string) => NapiComputeEngine;
  };
};

/**
 * Platform-specific package mapping for published SDK consumers.
 */
const PLATFORM_PACKAGES: Record<string, Record<string, string>> = {
  darwin: {
    arm64: '@mog-sdk/darwin-arm64',
    x64: '@mog-sdk/darwin-x64',
  },
  linux: {
    'x64-gnu': '@mog-sdk/linux-x64-gnu',
    'x64-musl': '@mog-sdk/linux-x64-musl',
    'arm64-gnu': '@mog-sdk/linux-arm64-gnu',
    'arm64-musl': '@mog-sdk/linux-arm64-musl',
  },
  win32: {
    x64: '@mog-sdk/win32-x64-msvc',
  },
};

/**
 * Returns the platform-specific package name for the current OS and architecture.
 * E.g., `@mog-sdk/darwin-arm64` on Apple Silicon macOS.
 */
export function getPlatformPackageName(): string {
  const platformMap = PLATFORM_PACKAGES[process.platform];
  if (!platformMap) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }
  const report = process.report?.getReport?.() as
    | { readonly header?: { readonly glibcVersionRuntime?: string } }
    | undefined;
  const reportHeader = report?.header;
  const archKey =
    process.platform === 'linux'
      ? `${process.arch}-${reportHeader?.glibcVersionRuntime ? 'gnu' : 'musl'}`
      : process.arch;
  const pkg = platformMap[archKey];
  if (!pkg) {
    throw new Error(`Unsupported architecture ${process.arch} on ${process.platform}`);
  }
  return pkg;
}

/**
 * Auto-discover and load the compute-core NAPI addon.
 * Throws AddonNotFoundError if not found.
 * Use this when the caller EXPECTS NAPI (e.g., SDK consumers).
 *
 * Load order:
 * 1. Platform package (`@mog-sdk/{platform}-{arch}`) — for published consumers
 * The public SDK contract only resolves published platform packages.
 */
export function loadNapiAddon(): NapiAddonModule {
  const esmRequire = getRequire();

  // Try the platform-specific package published with the public SDK.
  try {
    const pkg = getPlatformPackageName();
    return esmRequire(pkg);
  } catch {
    const pkg = getPlatformPackageName();
    throw new AddonNotFoundError(
      'compute-core',
      `No compute-core NAPI addon found.\n` + `Install the platform package: npm add ${pkg}`,
    );
  }
}

/**
 * Try to load the compute-core NAPI addon.
 * Returns undefined if not found (silent fallback).
 * Use this in the transport factory's auto-detection path
 * so tests running in Jest/Node fall back to WASM gracefully.
 *
 * Only public platform packages are considered. Private workspace-native
 * packages must not leak into packed public SDK artifacts.
 */
export function tryLoadNapiAddon(): NapiAddonModule | undefined {
  let esmRequire: NodeRequire;
  try {
    esmRequire = getRequire();
  } catch {
    return undefined;
  }

  // Try the platform-specific package published with the public SDK.
  try {
    const pkg = getPlatformPackageName();
    return esmRequire(pkg);
  } catch {
    return undefined;
  }
}
