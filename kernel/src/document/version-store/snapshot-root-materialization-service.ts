import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  type ObjectDigest,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from './object-digest';
import {
  createCheckoutMaterializationService,
  type CheckoutHeadReadResult,
  type CheckoutMaterializationDiagnostic,
  type CheckoutMaterializationRequest,
  type CheckoutMaterializationResult,
} from './checkout-service';
import { VERSION_GRAPH_MAIN_REF, type VersionGraphRef } from './graph-store';
import type { VersionGraphNamespace, VersionObjectRecord } from './object-store';
import { VersionObjectStoreError } from './object-store';
import type {
  VersionGraphStore,
  VersionStoreDiagnostic,
  VersionStoreProvider,
} from './provider';
import type { GetRefResult, LiveRefRecord, RefVersion, VersionDiagnostic } from './ref-store';
import { parseRefName, type RefName } from './ref-name';
import { namespaceForRegistry } from './registry';
import {
  createSnapshotRootReloadService,
  type SnapshotRootFreshLifecycleHydrator,
  type SnapshotRootReloadDiagnostic,
  type SnapshotRootReloadResult,
  type SnapshotRootReloadService,
} from './snapshot-root-reload-service';

const MATERIALIZATION_REF_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'version-store',
  actorKind: 'system',
  displayName: 'Version Store',
});
const MATERIALIZATION_MAIN_REF_NAME = parseRefName('main');

export type SnapshotRootMaterializationDiagnosticCode =
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_PROVIDER_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_CHECKOUT_PLAN_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_COMMIT_READ_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_OBJECT_READ_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED';

type SnapshotRootMaterializationSourceDiagnostic =
  | VersionStoreDiagnostic
  | CheckoutMaterializationDiagnostic
  | SnapshotRootReloadDiagnostic
  | Readonly<Record<string, unknown>>;

export interface SnapshotRootMaterializationDiagnostic {
  readonly code: SnapshotRootMaterializationDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly namespace?: VersionGraphNamespace;
  readonly commitId?: WorkbookCommitId;
  readonly objectDigest?: ObjectDigest;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly SnapshotRootMaterializationSourceDiagnostic[];
}

export type SnapshotRootMaterializationResult<TMaterialized = unknown> =
  | {
      readonly ok: true;
      readonly materialization: 'fresh-lifecycle';
      readonly commitId: WorkbookCommitId;
      readonly snapshotRootDigest: ObjectDigest;
      readonly snapshotRootRecord: VersionObjectRecord<unknown>;
      readonly materialized: TMaterialized;
      readonly decodedByteLength: number;
      readonly diagnostics: readonly SnapshotRootMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-current-workbook-mutation';
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: SnapshotRootMaterializationDiagnosticCode;
        readonly message: string;
        readonly diagnostics: readonly SnapshotRootMaterializationDiagnostic[];
      };
      readonly commitId?: WorkbookCommitId;
      readonly snapshotRootDigest?: ObjectDigest;
      readonly decodedByteLength?: number;
      readonly diagnostics: readonly SnapshotRootMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-current-workbook-mutation';
    };

export interface SnapshotRootMaterializationServiceOptions<TMaterialized = unknown> {
  readonly provider: VersionStoreProvider;
  readonly reloadService?: SnapshotRootReloadService<TMaterialized>;
  readonly hydrator?: SnapshotRootFreshLifecycleHydrator<TMaterialized>;
}

export class SnapshotRootMaterializationService<TMaterialized = unknown> {
  private readonly provider: VersionStoreProvider;
  private readonly reloadService: SnapshotRootReloadService<TMaterialized>;

  constructor(options: SnapshotRootMaterializationServiceOptions<TMaterialized>) {
    this.provider = options.provider;
    this.reloadService =
      options.reloadService ??
      createSnapshotRootReloadService({
        hydrator: requiredHydrator(options.hydrator),
      });
  }

  async materializeCommitSnapshotRoot(
    commitIdInput: WorkbookCommitId | string,
  ): Promise<SnapshotRootMaterializationResult<TMaterialized>> {
    return this.materializeSnapshotRoot({ target: 'commit', commitId: commitIdInput });
  }

  async materializeSnapshotRoot(
    request: CheckoutMaterializationRequest,
  ): Promise<SnapshotRootMaterializationResult<TMaterialized>> {
    const opened = await this.openVisibleGraph();
    if (!opened.ok) return opened.result;

    const planned = await createCheckoutMaterializationService({
      commitReader: {
        readCommit: (commitId) => opened.graph.readCommit(commitId),
      },
      dependencyReader: {
        hasDependency: (dependency) => opened.graph.hasObject(dependency),
      },
      headReader: {
        readHead: () => readGraphHead(opened.graph),
      },
      refReader: {
        readRef: (refName) => readGraphRef(opened.graph, refName),
      },
    }).planCheckout(request);
    if (!planned.ok) return checkoutPlanFailure(opened.namespace, planned);

    const { plan } = planned;
    const snapshotRootDigest = cloneDigest(plan.snapshotRootDigest);
    let snapshotRootRecord: VersionObjectRecord<unknown>;
    try {
      snapshotRootRecord = await opened.graph.getObjectRecord(snapshotRootDependency(plan));
    } catch (error) {
      return failure(
        'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_OBJECT_READ_FAILED',
        'Snapshot-root object could not be read for materialization.',
        {
          namespace: opened.namespace,
          commitId: plan.commitId,
          snapshotRootDigest,
          sourceDiagnostics: diagnosticsFromObjectReadError(error),
        },
      );
    }

    const reloaded = await this.reloadService.reloadSnapshotRoot(snapshotRootRecord);
    if (!reloaded.ok) {
      return reloadFailure(plan.commitId, snapshotRootDigest, reloaded);
    }

    return Object.freeze({
      ok: true as const,
      materialization: 'fresh-lifecycle' as const,
      commitId: plan.commitId,
      snapshotRootDigest,
      snapshotRootRecord,
      materialized: reloaded.materialized,
      decodedByteLength: reloaded.decodedByteLength,
      diagnostics: [],
      mutationGuarantee: 'no-current-workbook-mutation' as const,
    });
  }

  private async openVisibleGraph(): Promise<
    | {
        readonly ok: true;
        readonly namespace: VersionGraphNamespace;
        readonly graph: VersionGraphStore;
      }
    | {
        readonly ok: false;
        readonly result: Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }>;
      }
  > {
    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return {
          ok: false,
          result: failure(
            'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_PROVIDER_FAILED',
            'Visible version graph registry is unavailable for snapshot-root materialization.',
            {
              sourceDiagnostics: registryRead.diagnostics,
            },
          ),
        };
      }

      const namespace = namespaceForRegistry(registryRead.registry);
      return {
        ok: true,
        namespace,
        graph: await this.provider.openGraph(namespace, this.provider.accessContext),
      };
    } catch (error) {
      return {
        ok: false,
        result: failure(
          'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_PROVIDER_FAILED',
          'Visible version graph could not be opened for snapshot-root materialization.',
          {
            sourceDiagnostics: [{ cause: errorName(error) }],
          },
        ),
      };
    }
  }
}

export function createSnapshotRootMaterializationService<TMaterialized = unknown>(
  options: SnapshotRootMaterializationServiceOptions<TMaterialized>,
): SnapshotRootMaterializationService<TMaterialized> {
  return new SnapshotRootMaterializationService(options);
}

function snapshotRootDependency(
  plan: Extract<CheckoutMaterializationResult, { ok: true; materialization: 'planned' }>['plan'],
): VersionDependencyRef {
  const dependency = plan.requiredDependencies.find((entry) => entry.role === 'snapshotRoot');
  return Object.freeze({
    kind: 'object',
    objectType: dependency?.objectType ?? 'workbook.snapshotRoot.v1',
    digest: cloneDigest(dependency?.digest ?? plan.snapshotRootDigest),
  });
}

function checkoutPlanFailure<TMaterialized>(
  namespace: VersionGraphNamespace,
  planned: Extract<CheckoutMaterializationResult, { ok: false }>,
): Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }> {
  const first = planned.diagnostics[0];
  return failure(
    first?.code === 'VERSION_CHECKOUT_COMMIT_READ_FAILED' ||
      first?.code === 'VERSION_CHECKOUT_MISSING_COMMIT'
      ? 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_COMMIT_READ_FAILED'
      : 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_CHECKOUT_PLAN_FAILED',
    'Checkout planning failed before snapshot-root materialization.',
    {
      namespace,
      commitId: first?.commitId,
      snapshotRootDigest: first?.objectDigest,
      sourceDiagnostics: planned.diagnostics,
    },
  );
}

async function readGraphHead(graph: VersionGraphStore): Promise<CheckoutHeadReadResult> {
  const result = await graph.readHead();
  if (result.status !== 'success') {
    return {
      ok: false,
      diagnostics: checkoutDiagnostics(
        'VERSION_CHECKOUT_REF_READ_FAILED',
        'Version graph HEAD could not be read.',
        result.diagnostics,
      ),
    };
  }

  return {
    ok: true,
    head: {
      mode: 'attached',
      refName: 'main',
      commitId: result.head.id,
      refVersion: cloneRefVersion(result.head.refRevision),
    },
    diagnostics: [],
  };
}

async function readGraphRef(graph: VersionGraphStore, refName: RefName): Promise<GetRefResult> {
  if (refName !== MATERIALIZATION_MAIN_REF_NAME) {
    return { ok: true, ref: null, diagnostics: [] };
  }

  const result = await graph.readRef(VERSION_GRAPH_MAIN_REF);
  if (result.status !== 'success' || result.ref.name !== VERSION_GRAPH_MAIN_REF) {
    return {
      ok: false,
      error: {
        code: 'versionCapabilityDisabled',
        message: 'Version graph ref could not be read.',
      },
      diagnostics: refDiagnostics(
        'VERSION_CHECKOUT_REF_READ_FAILED',
        'Version graph ref could not be read.',
        result.diagnostics,
      ),
    };
  }

  return {
    ok: true,
    ref: liveRefFromGraphRef(graph.namespace, result.ref),
    diagnostics: [],
  };
}

function liveRefFromGraphRef(
  namespace: VersionGraphNamespace,
  ref: VersionGraphRef,
): LiveRefRecord {
  const refVersion = cloneRefVersion(ref.revision);
  return Object.freeze({
    state: 'live',
    schemaVersion: 1,
    versionDocumentId: namespace.documentId,
    name: MATERIALIZATION_MAIN_REF_NAME,
    kind: 'branch',
    targetCommitId: ref.commitId,
    providerRefId: `graph-ref:${namespace.graphId}:main`,
    providerEpoch: refVersion,
    refIncarnationId: `ref-incarnation:${namespace.graphId}:main`,
    protected: true,
    createdAt: ref.updatedAt,
    createdBy: MATERIALIZATION_REF_AUTHOR,
    updatedAt: ref.updatedAt,
    updatedBy: MATERIALIZATION_REF_AUTHOR,
    refVersion,
  });
}

function checkoutDiagnostics(
  code: CheckoutMaterializationDiagnostic['code'],
  message: string,
  sourceDiagnostics: readonly { readonly code: string }[],
): readonly CheckoutMaterializationDiagnostic[] {
  return [
    Object.freeze({
      code,
      severity: 'error',
      message,
      details: { cause: sourceDiagnostics[0]?.code ?? 'unknown' },
    }),
  ];
}

function refDiagnostics(
  code: string,
  message: string,
  sourceDiagnostics: readonly { readonly code: string }[],
): readonly VersionDiagnostic[] {
  return [
    {
      code,
      severity: 'error',
      message,
      details: { cause: sourceDiagnostics[0]?.code ?? 'unknown' },
    },
  ];
}

function reloadFailure<TMaterialized>(
  commitId: WorkbookCommitId,
  snapshotRootDigest: ObjectDigest,
  reloaded: Extract<SnapshotRootReloadResult<TMaterialized>, { ok: false }>,
): Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }> {
  return failure(
    'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED',
    'Snapshot-root object could not be materialized through a fresh lifecycle.',
    {
      commitId,
      snapshotRootDigest,
      decodedByteLength: reloaded.decodedByteLength,
      sourceDiagnostics: reloaded.diagnostics,
    },
  );
}

function failure<TMaterialized>(
  code: SnapshotRootMaterializationDiagnosticCode,
  message: string,
  options: {
    readonly namespace?: VersionGraphNamespace;
    readonly commitId?: WorkbookCommitId;
    readonly snapshotRootDigest?: ObjectDigest;
    readonly decodedByteLength?: number;
    readonly sourceDiagnostics?: SnapshotRootMaterializationDiagnostic['sourceDiagnostics'];
  } = {},
): Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }> {
  const diagnostics = [
    diagnostic(code, message, {
      namespace: options.namespace,
      commitId: options.commitId,
      objectDigest: options.snapshotRootDigest,
      sourceDiagnostics: options.sourceDiagnostics,
    }),
  ];
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message, diagnostics }),
    ...(options.commitId ? { commitId: options.commitId } : {}),
    ...(options.snapshotRootDigest ? { snapshotRootDigest: options.snapshotRootDigest } : {}),
    ...(options.decodedByteLength === undefined
      ? {}
      : { decodedByteLength: options.decodedByteLength }),
    diagnostics,
    mutationGuarantee: 'no-current-workbook-mutation' as const,
  });
}

function diagnostic(
  code: SnapshotRootMaterializationDiagnosticCode,
  message: string,
  options: Omit<SnapshotRootMaterializationDiagnostic, 'code' | 'severity' | 'message'> = {},
): SnapshotRootMaterializationDiagnostic {
  return Object.freeze({
    code,
    severity: code === 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_OBJECT_READ_FAILED'
      ? 'corruption'
      : 'error',
    message,
    ...options,
  });
}

function diagnosticsFromObjectReadError(
  error: unknown,
): readonly SnapshotRootMaterializationSourceDiagnostic[] {
  if (error instanceof VersionObjectStoreError) return [error.diagnostic];
  return [{ cause: errorName(error) }];
}

function requiredHydrator<TMaterialized>(
  hydrator: SnapshotRootFreshLifecycleHydrator<TMaterialized> | undefined,
): SnapshotRootFreshLifecycleHydrator<TMaterialized> {
  if (hydrator) return hydrator;
  return {
    hydrateYrsFullState: async () => ({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_REJECTED',
          severity: 'error',
          message: 'Snapshot-root materialization service has no fresh lifecycle hydrator.',
        },
      ],
      freshLifecycleMutationGuarantee: 'no-fresh-lifecycle-mutation',
    }),
  };
}

function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return Object.freeze({ algorithm: digest.algorithm, digest: digest.digest });
}

function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
