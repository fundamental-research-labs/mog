import { KernelError, type KernelErrorOptions } from './kernel-error';
import type { KernelErrorCode } from './codes';

export class BridgeError extends KernelError {
  constructor(
    code: KernelErrorCode,
    public readonly command: string,
    message: string,
    options?: KernelErrorOptions,
  ) {
    super(code, message, { ...options, context: { ...options?.context, command } });
    this.name = 'BridgeError';
  }

  /** Wrap a caught error as a BridgeError, preserving the original as cause */
  static fromCommand(
    error: unknown,
    command: string,
    code: KernelErrorCode = 'BRIDGE_COMMAND_FAILED',
  ): BridgeError {
    if (error instanceof BridgeError) return error;
    const msg = error instanceof Error ? error.message : String(error);
    return new BridgeError(code, command, `[${command}] ${msg}`, { cause: error });
  }
}
