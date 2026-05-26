/**
 * SDK / platform-level error hierarchy.
 *
 * These are distinct from TransportError (which covers transport-level failures
 * such as WASM traps or NAPI call failures). SDK errors represent higher-level
 * issues: missing addons, corrupt files, unsupported operations, etc.
 */

/**
 * Base error for all SDK/platform errors.
 * Distinct from TransportError (which covers transport-level failures only).
 */
export class SdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdkError';
  }
}

/**
 * Thrown when a required native addon is not found.
 * Contains actionable instructions for building/installing.
 */
export class AddonNotFoundError extends SdkError {
  constructor(
    public readonly addonName: string,
    message: string,
  ) {
    super(message);
    this.name = 'AddonNotFoundError';
  }
}

/**
 * Thrown when XLSX import/hydration fails (corrupt file, parse error).
 */
export class HydrationError extends SdkError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HydrationError';
  }
}

/**
 * Thrown when an operation is not supported on the current platform.
 * Example: XLSX export in WASM (not yet implemented).
 */
export class UnsupportedPlatformError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedPlatformError';
  }
}

/**
 * Thrown when the compute engine fails during initialization.
 */
export class EngineInitError extends SdkError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EngineInitError';
  }
}
