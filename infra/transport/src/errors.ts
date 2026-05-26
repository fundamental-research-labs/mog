/**
 * Transport-level error for platform transport implementations.
 *
 * Analogous to kernel's BridgeError but with no kernel dependency.
 * Kernel's BridgeError.fromCommand() wraps TransportError as `cause`.
 */
export class TransportError extends Error {
  constructor(
    public readonly command: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${command}] ${message}`, options);
    this.name = 'TransportError';
  }

  /** Wrap a caught error as a TransportError, preserving the original as cause. */
  static fromCommand(error: unknown, command: string): TransportError {
    if (error instanceof TransportError) return error;
    const msg = error instanceof Error ? error.message : String(error);
    return new TransportError(command, msg, { cause: error });
  }
}

/**
 * A trap inside the WASM instance — wasm32 panic, OOB memory access, etc.
 * The instance is permanently dead; subsequent calls into it will keep
 * trapping. The kernel-level recovery coordinator detects this via the
 * `isTrap` discriminator and tears down + re-instantiates the module.
 *
 * Distinct from TransportError because it requires recovery, not just
 * error reporting.
 */
export class TrapError extends TransportError {
  readonly isTrap = true as const;
  constructor(command: string, trapMessage: string, options?: { cause?: unknown }) {
    super(command, `WASM trap during ${command}: ${trapMessage}`, options);
    this.name = 'TrapError';
  }
}

/**
 * Thrown when a required native addon is not found.
 * Contains actionable instructions for building/installing.
 */
export class AddonNotFoundError extends Error {
  constructor(
    public readonly addonName: string,
    message: string,
  ) {
    super(message);
    this.name = 'AddonNotFoundError';
  }
}
