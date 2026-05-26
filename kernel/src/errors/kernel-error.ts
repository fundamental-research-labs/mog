/**
 * KernelError — base error class for the kernel error system.
 *
 * Extracted to its own module to avoid circular imports: error subclass files
 * (capability.ts, bridge.ts, document.ts, etc.) need KernelError, and the
 * errors barrel (index.ts) re-exports those subclasses.
 *
 */

import type { KernelErrorCode } from './codes';

export interface KernelErrorOptions {
  /** Optional structured context for debugging/handling */
  context?: Record<string, unknown>;
  /** Optional user-facing suggestion for how to fix */
  suggestion?: string;
  /** Optional path to the parameter that caused the error (e.g. ['sheet', 'A1']) */
  path?: string[];
  /** Original error that caused this one (ES2022 cause chain) */
  cause?: unknown;
}

export class KernelError extends Error {
  public readonly code: KernelErrorCode;
  public readonly context: Record<string, unknown>;
  public readonly suggestion?: string;
  public readonly path?: string[];

  constructor(code: KernelErrorCode, message: string, options?: KernelErrorOptions) {
    super(message, options?.cause != null ? { cause: options.cause } : undefined);
    this.code = code;
    this.name = 'KernelError';
    this.context = options?.context ?? {};
    this.suggestion = options?.suggestion;
    this.path = options?.path;
  }

  /**
   * Wrap any caught error as a KernelError, preserving the original as `cause`.
   * If `error` is already a KernelError, returns it unchanged (no double-wrapping).
   */
  static from(
    error: unknown,
    code: KernelErrorCode,
    message?: string,
    options?: Omit<KernelErrorOptions, 'cause'>,
  ): KernelError {
    if (error instanceof KernelError) return error;
    const msg = message ?? (error instanceof Error ? error.message : String(error));
    return new KernelError(code, msg, { ...options, cause: error });
  }

  /**
   * Reconstruct a KernelError from its JSON representation (for IPC deserialization).
   * Recursively reconstructs cause chains.
   */
  static fromJSON(json: Record<string, unknown>): KernelError {
    const cause =
      json.cause != null ? KernelError.fromJSON(json.cause as Record<string, unknown>) : undefined;
    return new KernelError(json.code as KernelErrorCode, json.message as string, {
      context: (json.context as Record<string, unknown>) ?? undefined,
      suggestion: json.suggestion as string | undefined,
      path: json.path as string[] | undefined,
      cause,
    });
  }

  /** Serialize for logging/IPC. Recursively serializes cause chain. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      suggestion: this.suggestion,
      path: this.path,
      ...(this.cause instanceof KernelError ? { cause: this.cause.toJSON() } : {}),
    };
  }
}

/** Type guard — works for KernelError and all subclasses */
export function isKernelError(error: unknown): error is KernelError {
  return error instanceof KernelError;
}
