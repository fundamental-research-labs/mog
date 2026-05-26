/**
 * Structured construction error types for host context validation.
 *
 * Every rejection from `validateKernelHostContextForDocument` throws a
 * `HostContextConstructionError` with a machine-readable `code` and optional
 * `field` indicating which host context field failed validation.
 */

export class HostContextConstructionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'HostContextConstructionError';
  }
}
