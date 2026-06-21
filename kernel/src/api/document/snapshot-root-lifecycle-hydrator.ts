import type { Workbook } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type {
  SnapshotRootFreshLifecycleHydrationInput,
  SnapshotRootFreshLifecycleHydrationResult,
  SnapshotRootFreshLifecycleHydrator,
  SnapshotRootReloadDiagnostic,
} from '../../document/version-store/snapshot-root-reload-service';
import { DocumentFactory } from './document-factory';
import type { DocumentHandle, DocumentHandleInternal } from './document-handle-types';

type CreateFreshDocument = (options: {
  readonly documentId: string;
  readonly environment: 'headless';
  readonly userTimezone: string;
  readonly yrsState: Uint8Array;
  readonly skipDefaultSheet: true;
  readonly internal: true;
}) => Promise<DocumentHandle>;

export interface SnapshotRootFreshLifecycleMaterialization {
  readonly kind: 'snapshot-root-fresh-lifecycle';
  readonly documentId: string;
  readonly handle: DocumentHandle;
  readonly context: DocumentContext;
  readonly workbook: Workbook;
  dispose(): Promise<void>;
}

export interface DocumentLifecycleSnapshotRootHydratorOptions {
  readonly userTimezone: string;
  readonly documentIdPrefix?: string;
  readonly documentIdFactory?: (input: SnapshotRootFreshLifecycleHydrationInput) => string;
  readonly createDocument?: CreateFreshDocument;
}

export function createDocumentLifecycleSnapshotRootHydrator(
  options: DocumentLifecycleSnapshotRootHydratorOptions,
): SnapshotRootFreshLifecycleHydrator<SnapshotRootFreshLifecycleMaterialization> {
  const createDocument = options.createDocument ?? DocumentFactory.create;
  return {
    async hydrateYrsFullState(input) {
      let handle: DocumentHandle | undefined;
      try {
        handle = await createDocument({
          documentId: documentIdForHydration(options, input),
          environment: 'headless',
          userTimezone: options.userTimezone,
          yrsState: new Uint8Array(input.yrsFullStateBytes),
          skipDefaultSheet: true,
          internal: true,
        });
        const workbook = await handle.workbook();
        return {
          status: 'materialized',
          materialized: createMaterialization(handle, workbook),
        };
      } catch (error) {
        if (handle) await disposeQuietly(handle);
        return failedHydration(error);
      }
    },
  };
}

function createMaterialization(
  handle: DocumentHandle,
  workbook: Workbook,
): SnapshotRootFreshLifecycleMaterialization {
  const context = (handle as DocumentHandleInternal).context as DocumentContext;
  return Object.freeze({
    kind: 'snapshot-root-fresh-lifecycle' as const,
    documentId: handle.documentId,
    handle,
    context,
    workbook,
    dispose: () => handle.dispose(),
  });
}

function documentIdForHydration(
  options: DocumentLifecycleSnapshotRootHydratorOptions,
  input: SnapshotRootFreshLifecycleHydrationInput,
): string {
  if (options.documentIdFactory) return options.documentIdFactory(input);
  const prefix = options.documentIdPrefix ?? 'snapshot-root-reload';
  return `${prefix}-${input.source}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function failedHydration(
  error: unknown,
): SnapshotRootFreshLifecycleHydrationResult<SnapshotRootFreshLifecycleMaterialization> {
  return {
    status: 'failed',
    diagnostics: [
      diagnostic(
        'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED',
        'Snapshot root fresh-lifecycle document creation failed.',
        { cause: errorName(error) },
      ),
    ],
    freshLifecycleMutationGuarantee: 'unknown-after-hydrator-failure',
  };
}

function diagnostic(
  code: SnapshotRootReloadDiagnostic['code'],
  message: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): SnapshotRootReloadDiagnostic {
  return Object.freeze({
    code,
    severity: 'error',
    message,
    ...(details ? { details } : {}),
  });
}

async function disposeQuietly(handle: DocumentHandle): Promise<void> {
  try {
    await handle.dispose();
  } catch {
    // Best-effort cleanup after a failed scratch lifecycle creation.
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
