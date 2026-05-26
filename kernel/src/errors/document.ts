import { KernelError, type KernelErrorOptions } from './kernel-error';
import type { KernelErrorCode } from './codes';

export class DocumentLifecycleError extends KernelError {
  constructor(code: KernelErrorCode, message: string, options?: KernelErrorOptions) {
    super(code, message, options);
    this.name = 'DocumentLifecycleError';
  }
}

export class DocumentNotReadyError extends DocumentLifecycleError {
  constructor(message: string = 'Document context not ready', options?: KernelErrorOptions) {
    super('DOC_NOT_READY', message, options);
    this.name = 'DocumentNotReadyError';
  }
}

export class EngineCreateError extends DocumentLifecycleError {
  constructor(message: string, options?: KernelErrorOptions) {
    super('DOC_ENGINE_CREATE_FAILED', message, options);
    this.name = 'EngineCreateError';
  }
}

export class HydrationError extends DocumentLifecycleError {
  constructor(message: string, options?: KernelErrorOptions) {
    super('DOC_HYDRATION_FAILED', message, options);
    this.name = 'HydrationError';
  }
}

export class DocumentDisposedError extends DocumentLifecycleError {
  constructor(message: string = 'Document has been disposed', options?: KernelErrorOptions) {
    super('DOC_DISPOSED', message, options);
    this.name = 'DocumentDisposedError';
  }
}

export class HostContextValidationError extends DocumentLifecycleError {
  constructor(message: string, options?: KernelErrorOptions) {
    super('DOC_HOST_CONTEXT_VALIDATION', `[HostContextValidation] ${message}`, options);
    this.name = 'HostContextValidationError';
  }
}

export class LegacyOptionRejectedError extends DocumentLifecycleError {
  constructor(message: string, options?: KernelErrorOptions) {
    super('DOC_LEGACY_OPTION_REJECTED', message, options);
    this.name = 'LegacyOptionRejectedError';
  }
}

export class CollaborationFirstJoinRequiresHostBootstrapError extends DocumentLifecycleError {
  constructor(
    message: string = 'Collaboration first join requires host-backed bootstrap',
    options?: KernelErrorOptions,
  ) {
    super('API_UNSUPPORTED_OPERATION', message, options);
    this.name = 'CollaborationFirstJoinRequiresHostBootstrapError';
  }
}
