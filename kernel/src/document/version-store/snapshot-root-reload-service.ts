import type { ObjectDigest } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import {
  SnapshotRootCaptureError,
  decodeYrsFullStateSnapshotRootPayload,
  validateWorkbookSnapshotRootRecord,
  validateYrsFullStateSnapshotRootPayload,
  type WorkbookSnapshotRootPayload,
} from './snapshot-root-capture';

type MaybePromise<T> = T | Promise<T>;
type DiagnosticDetails = Readonly<Record<string, string | number | boolean | null>>;

export type SnapshotRootReloadSourceKind = 'record' | 'payload';

export type SnapshotRootReloadDiagnosticCode =
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_REJECTED'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_HYDRATOR_RESULT';

export type SnapshotRootReloadErrorCode =
  | 'invalidSnapshotRoot'
  | 'hydratorFailed'
  | 'hydratorRejected'
  | 'invalidHydratorResult';

export type SnapshotRootReloadInput = VersionObjectRecord<unknown> | WorkbookSnapshotRootPayload;

export type SnapshotRootCurrentWorkbookMutationGuarantee = 'no-current-workbook-mutation';

export type SnapshotRootFreshLifecycleMutationGuarantee =
  | 'not-started'
  | 'no-fresh-lifecycle-mutation'
  | 'fresh-lifecycle-materialized'
  | 'unknown-after-hydrator-failure';

export interface SnapshotRootReloadDiagnostic {
  readonly code: SnapshotRootReloadDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error' | 'corruption';
  readonly message: string;
  readonly path?: string;
  readonly details?: DiagnosticDetails;
}

export interface SnapshotRootReloadError {
  readonly code: SnapshotRootReloadErrorCode;
  readonly message: string;
  readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
}

export interface SnapshotRootFreshLifecycleHydrationInput {
  readonly yrsFullStateBytes: Uint8Array;
  readonly byteLength: number;
  readonly source: SnapshotRootReloadSourceKind;
  readonly objectDigest?: ObjectDigest;
}

export type SnapshotRootFreshLifecycleHydrationResult<TMaterialized = unknown> =
  | {
      readonly status: 'materialized';
      readonly materialized: TMaterialized;
      readonly diagnostics?: readonly SnapshotRootReloadDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
      readonly freshLifecycleMutationGuarantee?: Extract<
        SnapshotRootFreshLifecycleMutationGuarantee,
        'no-fresh-lifecycle-mutation' | 'unknown-after-hydrator-failure'
      >;
    };

export interface SnapshotRootFreshLifecycleHydrator<TMaterialized = unknown> {
  hydrateYrsFullState(
    input: SnapshotRootFreshLifecycleHydrationInput,
  ): MaybePromise<SnapshotRootFreshLifecycleHydrationResult<TMaterialized>>;
}

export interface SnapshotRootReloadServiceOptions<TMaterialized = unknown> {
  readonly hydrator: SnapshotRootFreshLifecycleHydrator<TMaterialized>;
}

export type SnapshotRootReloadResult<TMaterialized = unknown> =
  | {
      readonly ok: true;
      readonly materialization: 'fresh-lifecycle';
      readonly materialized: TMaterialized;
      readonly decodedByteLength: number;
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
      readonly mutationGuarantee: SnapshotRootCurrentWorkbookMutationGuarantee;
      readonly freshLifecycleMutationGuarantee: Extract<
        SnapshotRootFreshLifecycleMutationGuarantee,
        'fresh-lifecycle-materialized'
      >;
    }
  | {
      readonly ok: false;
      readonly error: SnapshotRootReloadError;
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
      readonly decodedByteLength?: number;
      readonly mutationGuarantee: SnapshotRootCurrentWorkbookMutationGuarantee;
      readonly freshLifecycleMutationGuarantee: Exclude<
        SnapshotRootFreshLifecycleMutationGuarantee,
        'fresh-lifecycle-materialized'
      >;
    };

type DecodedSnapshotRoot = {
  readonly source: SnapshotRootReloadSourceKind;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly objectDigest?: ObjectDigest;
};

export class SnapshotRootReloadService<TMaterialized = unknown> {
  private readonly hydrator: SnapshotRootFreshLifecycleHydrator<TMaterialized>;

  constructor(options: SnapshotRootReloadServiceOptions<TMaterialized>) {
    this.hydrator = options.hydrator;
  }

  async reloadSnapshotRoot(snapshotRoot: unknown): Promise<SnapshotRootReloadResult<TMaterialized>> {
    let decoded: DecodedSnapshotRoot;
    try {
      decoded = decodeSnapshotRoot(snapshotRoot);
    } catch (error) {
      return failure(
        'invalidSnapshotRoot',
        'Snapshot root is not a materializable yrs full-state snapshot root.',
        [invalidSnapshotRootDiagnostic(error)],
        'not-started',
      );
    }

    let hydration: SnapshotRootFreshLifecycleHydrationResult<TMaterialized>;
    try {
      hydration = await this.hydrator.hydrateYrsFullState(
        createHydrationInput(decoded, cloneBytes(decoded.bytes)),
      );
    } catch (error) {
      return failure(
        'hydratorFailed',
        'Snapshot root fresh-lifecycle hydrator threw before reporting materialization.',
        [
          diagnostic(
            'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED',
            'Snapshot root fresh-lifecycle hydrator threw before reporting materialization.',
            { details: { cause: errorName(error) } },
          ),
        ],
        'unknown-after-hydrator-failure',
        decoded.byteLength,
      );
    }

    if (!isPlainRecord(hydration)) {
      return invalidHydratorResult(decoded.byteLength);
    }

    if (hydration.status === 'materialized') {
      const result: Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: true }> =
        Object.freeze({
          ok: true,
          materialization: 'fresh-lifecycle',
          materialized: hydration.materialized,
          decodedByteLength: decoded.byteLength,
          diagnostics: freezeDiagnostics(hydration.diagnostics ?? []),
          mutationGuarantee: 'no-current-workbook-mutation',
          freshLifecycleMutationGuarantee: 'fresh-lifecycle-materialized',
        });
      return result;
    }

    if (hydration.status === 'failed') {
      const hydratorDiagnostics = freezeDiagnostics(hydration.diagnostics);
      return failure(
        'hydratorRejected',
        'Snapshot root fresh-lifecycle hydrator did not materialize the snapshot root.',
        hydratorDiagnostics.length > 0
          ? hydratorDiagnostics
          : [
              diagnostic(
                'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_REJECTED',
                'Snapshot root fresh-lifecycle hydrator did not materialize the snapshot root.',
              ),
            ],
        hydration.freshLifecycleMutationGuarantee ?? 'unknown-after-hydrator-failure',
        decoded.byteLength,
      );
    }

    return invalidHydratorResult(decoded.byteLength);
  }
}

export function createSnapshotRootReloadService<TMaterialized = unknown>(
  options: SnapshotRootReloadServiceOptions<TMaterialized>,
): SnapshotRootReloadService<TMaterialized> {
  return new SnapshotRootReloadService(options);
}

function decodeSnapshotRoot(snapshotRoot: unknown): DecodedSnapshotRoot {
  if (isVersionObjectRecordCandidate(snapshotRoot)) {
    const record = validateWorkbookSnapshotRootRecord(snapshotRoot as VersionObjectRecord<unknown>);
    const bytes = decodeYrsFullStateSnapshotRootPayload(record.preimage.payload);
    return Object.freeze({
      source: 'record',
      bytes,
      byteLength: bytes.byteLength,
      objectDigest: cloneDigest(record.digest),
    });
  }

  const payload = validateYrsFullStateSnapshotRootPayload(snapshotRoot);
  const bytes = decodeYrsFullStateSnapshotRootPayload(payload);
  return Object.freeze({
    source: 'payload',
    bytes,
    byteLength: bytes.byteLength,
  });
}

function createHydrationInput(
  decoded: DecodedSnapshotRoot,
  bytes: Uint8Array,
): SnapshotRootFreshLifecycleHydrationInput {
  return Object.freeze({
    yrsFullStateBytes: bytes,
    byteLength: decoded.byteLength,
    source: decoded.source,
    ...(decoded.objectDigest === undefined
      ? {}
      : { objectDigest: cloneDigest(decoded.objectDigest) }),
  });
}

function invalidSnapshotRootDiagnostic(error: unknown): SnapshotRootReloadDiagnostic {
  if (error instanceof SnapshotRootCaptureError) {
    return diagnostic(
      'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
      error.message,
      {
        path: error.path,
        details: { captureCode: error.code },
      },
    );
  }

  return diagnostic(
    'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
    'Snapshot root validation failed.',
    { details: { cause: errorName(error) } },
  );
}

function invalidHydratorResult<TMaterialized>(
  decodedByteLength: number,
): SnapshotRootReloadResult<TMaterialized> {
  return failure(
    'invalidHydratorResult',
    'Snapshot root fresh-lifecycle hydrator returned an invalid result.',
    [
      diagnostic(
        'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_HYDRATOR_RESULT',
        'Snapshot root fresh-lifecycle hydrator returned an invalid result.',
      ),
    ],
    'unknown-after-hydrator-failure',
    decodedByteLength,
  );
}

function failure<TMaterialized>(
  code: SnapshotRootReloadErrorCode,
  message: string,
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
  freshLifecycleMutationGuarantee: Exclude<
    SnapshotRootFreshLifecycleMutationGuarantee,
    'fresh-lifecycle-materialized'
  >,
  decodedByteLength?: number,
): SnapshotRootReloadResult<TMaterialized> {
  const frozenDiagnostics = freezeDiagnostics(diagnostics);
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message,
      diagnostics: frozenDiagnostics,
    }),
    diagnostics: frozenDiagnostics,
    ...(decodedByteLength === undefined ? {} : { decodedByteLength }),
    mutationGuarantee: 'no-current-workbook-mutation',
    freshLifecycleMutationGuarantee,
  });
}

function diagnostic(
  code: SnapshotRootReloadDiagnosticCode,
  message: string,
  options: Omit<SnapshotRootReloadDiagnostic, 'code' | 'severity' | 'message'> & {
    readonly severity?: SnapshotRootReloadDiagnostic['severity'];
  } = {},
): SnapshotRootReloadDiagnostic {
  const { severity = 'error', details, ...rest } = options;
  return Object.freeze({
    code,
    severity,
    message,
    ...rest,
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }),
  });
}

function freezeDiagnostics(
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
): readonly SnapshotRootReloadDiagnostic[] {
  return Object.freeze(
    diagnostics.map((entry) =>
      diagnostic(entry.code, entry.message, {
        severity: entry.severity,
        ...(entry.path === undefined ? {} : { path: entry.path }),
        ...(entry.details === undefined ? {} : { details: entry.details }),
      }),
    ),
  );
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return Object.freeze({ algorithm: digest.algorithm, digest: digest.digest });
}

function isVersionObjectRecordCandidate(value: unknown): value is VersionObjectRecord<unknown> {
  return isPlainRecord(value) && isPlainRecord(value.preimage);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
