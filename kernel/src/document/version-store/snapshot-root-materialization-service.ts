import {
  createCheckoutMaterializationService,
  type CheckoutMaterializationRequest,
} from './checkout-service';
import { namespaceForRegistry } from './registry';
import {
  createSnapshotRootReloadService,
  type SnapshotRootReloadService,
} from './snapshot-root-reload-service';
import { snapshotRootDependency } from './snapshot-root-materialization-service-dependencies';
import { readGraphHead, readGraphRef } from './snapshot-root-materialization-service-graph-readers';
import { requiredHydrator } from './snapshot-root-materialization-service-hydrator';
import {
  checkoutPlanFailure,
  diagnosticsFromObjectReadError,
  failure,
  reloadFailure,
} from './snapshot-root-materialization-service-results';
import type {
  SnapshotRootMaterializationDiagnostic,
  SnapshotRootMaterializationResult,
  SnapshotRootMaterializationServiceOptions,
} from './snapshot-root-materialization-service-types';
import { cloneDigest, errorName } from './snapshot-root-materialization-service-utils';
import type { WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace, VersionObjectRecord } from './object-store';
import type { VersionGraphStore } from './provider';

export type {
  SnapshotRootMaterializationDiagnostic,
  SnapshotRootMaterializationDiagnosticCode,
  SnapshotRootMaterializationResult,
  SnapshotRootMaterializationServiceOptions,
} from './snapshot-root-materialization-service-types';

export class SnapshotRootMaterializationService<TMaterialized = unknown> {
  private readonly provider: SnapshotRootMaterializationServiceOptions<TMaterialized>['provider'];
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

    const settleDiagnostics = await settleMaterializedMirrorState(reloaded.materialized);
    if (settleDiagnostics.length > 0) {
      await disposeMaterializedQuietly(reloaded.materialized);
      return failure(
        'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_MIRROR_SETTLE_FAILED',
        'Snapshot-root fresh lifecycle could not settle mirrored sheet state.',
        {
          namespace: opened.namespace,
          commitId: plan.commitId,
          snapshotRootDigest,
          decodedByteLength: reloaded.decodedByteLength,
          sourceDiagnostics: settleDiagnostics,
        },
      );
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

type MaterializedMirrorSettler = () => unknown;

async function settleMaterializedMirrorState(
  materialized: unknown,
): Promise<readonly SnapshotRootMaterializationDiagnostic[]> {
  const settle = materializedMirrorSettler(materialized);
  if (!settle) return [];

  try {
    await settle();
    return [];
  } catch (error) {
    return Object.freeze([
      Object.freeze({
        code: 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_MIRROR_SETTLE_FAILED' as const,
        severity: 'error' as const,
        message: 'Snapshot-root fresh lifecycle mirror settlement failed.',
        details: {
          cause: errorName(error),
          phase: 'settleForMirror',
        },
      }),
    ]);
  }
}

function materializedMirrorSettler(materialized: unknown): MaterializedMirrorSettler | null {
  if (!isRecord(materialized)) return null;
  const context = materialized.context;
  if (!isRecord(context)) return null;
  const computeBridge = context.computeBridge;
  if (!isRecord(computeBridge)) return null;
  const settleForMirror = computeBridge.settleForMirror;
  if (typeof settleForMirror !== 'function') return null;
  return () => Reflect.apply(settleForMirror, computeBridge, []) as unknown;
}

async function disposeMaterializedQuietly(materialized: unknown): Promise<void> {
  if (!isRecord(materialized) || typeof materialized.dispose !== 'function') return;
  try {
    await Reflect.apply(materialized.dispose, materialized, []);
  } catch {
    // Materialization failure is already reported; disposal is best-effort cleanup.
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function createSnapshotRootMaterializationService<TMaterialized = unknown>(
  options: SnapshotRootMaterializationServiceOptions<TMaterialized>,
): SnapshotRootMaterializationService<TMaterialized> {
  return new SnapshotRootMaterializationService(options);
}
