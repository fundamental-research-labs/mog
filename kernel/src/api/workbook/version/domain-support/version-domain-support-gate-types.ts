import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';
import type { VersionDomainCapabilityKey } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../../../context';
import type {
  DomainSupportDetectorRow,
  DomainSupportManifestValidationOperation,
  DomainSupportManifestValidationOptions,
} from '../../../../document/version-store/domain-support-manifest-validator';

export type MaybePromise<T> = T | Promise<T>;

export type VersionDomainSupportManifestGateOperation =
  | 'commit'
  | 'diff'
  | 'checkout'
  | 'merge'
  | 'applyMerge'
  | 'review'
  | 'reviewAccess'
  | 'import'
  | 'export'
  | 'revert'
  | 'undo'
  | 'redo';

export type MaybeDomainSupportManifestContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type DomainSupportDetectionResult = {
  readonly detectorRows: readonly DomainSupportDetectorRow[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
};

export type WorkbookMutableDomainDetector = {
  readonly matrixRowId: string;
  readonly domainId: string;
  readonly detectorId: string;
  readonly isPresent: (ctx: DocumentContext) => MaybePromise<boolean | null>;
};

export type AttachedDomainSupportManifestGate = {
  readonly hasManifestSource: boolean;
  readonly manifest?: unknown;
  readonly readManifest?: () => MaybePromise<unknown>;
  readonly options?: DomainSupportManifestValidationOptions;
};

export type VersionDomainSupportOperationCapabilityMatrixRow = {
  readonly requiredCapabilityKeys: readonly VersionDomainCapabilityKey[];
  readonly requiredMatrixRowIds: readonly string[];
  readonly validatorOperation?: DomainSupportManifestValidationOperation;
};

export function hasMethod(value: unknown, name: string): boolean {
  return isRecord(value) && typeof value[name] === 'function';
}

export function bindMethod(
  value: unknown,
  name: string,
): ((...args: readonly unknown[]) => MaybePromise<unknown>) | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
