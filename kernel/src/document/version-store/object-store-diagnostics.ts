import {
  VersionObjectDigestError,
  type ObjectDigest,
  type VersionDependencyRef,
  type VersionObjectDigestIssue,
  type VersionObjectType,
} from './object-digest';
import { VersionObjectHeaderError } from './object-header';
import type { VersionGraphNamespace } from './object-store-namespace';

export type VersionObjectStoreDiagnosticCode =
  | VersionObjectDigestIssue
  | 'VERSION_INVALID_NAMESPACE'
  | 'VERSION_WRONG_NAMESPACE'
  | 'VERSION_INVALID_PREIMAGE'
  | 'VERSION_UNSUPPORTED_SCHEMA'
  | 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING'
  | 'VERSION_INVALID_PAYLOAD'
  | 'VERSION_BYTE_LENGTH_MISMATCH'
  | 'VERSION_MISSING_DEPENDENCY'
  | 'VERSION_OBJECT_CORRUPTION'
  | 'VERSION_OBJECT_NOT_FOUND'
  | 'VERSION_OBJECT_TYPE_MISMATCH'
  | 'VERSION_STORE_UNAVAILABLE';

export type VersionObjectStoreDiagnostic = {
  readonly code: VersionObjectStoreDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly namespace?: VersionGraphNamespace;
  readonly digest?: ObjectDigest;
  readonly objectType?: VersionObjectType;
  readonly dependency?: VersionDependencyRef;
  readonly path?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export class VersionObjectStoreError extends Error {
  readonly diagnostic: VersionObjectStoreDiagnostic;

  constructor(diagnostic: VersionObjectStoreDiagnostic) {
    super(diagnostic.message);
    this.name = 'VersionObjectStoreError';
    this.diagnostic = diagnostic;
  }
}

class VersionObjectStoreValidationError extends Error {
  readonly diagnostic: VersionObjectStoreDiagnostic;

  constructor(diagnostic: VersionObjectStoreDiagnostic) {
    super(diagnostic.message);
    this.name = 'VersionObjectStoreValidationError';
    this.diagnostic = diagnostic;
  }
}

export function diagnosticFromError(error: unknown, path?: string): VersionObjectStoreDiagnostic {
  if (error instanceof VersionObjectStoreValidationError) {
    return error.diagnostic;
  }
  if (error instanceof VersionObjectStoreError) {
    return error.diagnostic;
  }
  if (error instanceof VersionObjectDigestError) {
    return diagnostic(error.issue, error.message, { path });
  }
  if (error instanceof VersionObjectHeaderError) {
    return diagnostic(error.issue, error.message, {
      path: error.path,
      ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
    });
  }
  if (error instanceof Error) {
    return diagnostic('VERSION_INVALID_PREIMAGE', error.message, { path });
  }
  return diagnostic('VERSION_INVALID_PREIMAGE', 'Version object validation failed.', { path });
}

export function diagnostic(
  code: VersionObjectStoreDiagnosticCode,
  message: string,
  options: DiagnosticOptions = {},
): VersionObjectStoreDiagnostic {
  return Object.freeze({
    code,
    severity: options.severity ?? (code === 'VERSION_OBJECT_CORRUPTION' ? 'corruption' : 'error'),
    message,
    ...(options.namespace ? { namespace: options.namespace } : {}),
    ...(options.digest ? { digest: options.digest } : {}),
    ...(options.objectType ? { objectType: options.objectType } : {}),
    ...(options.dependency ? { dependency: options.dependency } : {}),
    ...(options.path ? { path: options.path } : {}),
    ...(options.details ? { details: options.details } : {}),
  });
}

export function throwValidation(
  code: VersionObjectStoreDiagnosticCode,
  message: string,
  options: DiagnosticOptions = {},
): never {
  throw new VersionObjectStoreValidationError(diagnostic(code, message, options));
}

type DiagnosticOptions = {
  readonly namespace?: VersionGraphNamespace;
  readonly digest?: ObjectDigest;
  readonly objectType?: VersionObjectType;
  readonly dependency?: VersionDependencyRef;
  readonly path?: string;
  readonly severity?: 'error' | 'corruption';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};
