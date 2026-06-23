import type { VersionStoreProvider } from './provider';
import { createSnapshotRootMaterializationService } from './snapshot-root-materialization-service';
import { persistVersionPersistenceBoundary } from './version-persistence-boundary';
import {
  versionPersistenceReloadMaterializationFailure,
  versionPersistenceReloadServiceUnavailable,
} from './version-persistence-reload';
import type {
  VersionPersistenceBoundaryRequest,
  VersionPersistenceBoundaryResult,
  VersionPersistenceOptions,
  VersionPersistenceReloadRequest,
  VersionPersistenceReloadResult,
  VersionPersistenceSnapshotRootMaterializer,
} from './version-persistence-types';

export type {
  VersionPersistenceBoundaryDiagnostic,
  VersionPersistenceBoundaryDiagnosticCode,
  VersionPersistenceBoundaryDiagnosticSource,
  VersionPersistenceBoundaryKind,
  VersionPersistenceBoundaryRequest,
  VersionPersistenceBoundaryResult,
  VersionPersistenceOptions,
  VersionPersistenceReloadDiagnostic,
  VersionPersistenceReloadDiagnosticCode,
  VersionPersistenceReloadDiagnosticSource,
  VersionPersistenceReloadRequest,
  VersionPersistenceReloadResult,
  VersionPersistenceSnapshotRootMaterializer,
} from './version-persistence-types';

export class VersionPersistence<TMaterialized = unknown> {
  private readonly provider?: VersionStoreProvider;
  private readonly materializationService?: VersionPersistenceSnapshotRootMaterializer<TMaterialized>;

  constructor(options: VersionPersistenceOptions<TMaterialized> = {}) {
    this.provider = options.provider;
    this.materializationService =
      options.materializationService ??
      (options.provider
        ? createSnapshotRootMaterializationService({
            provider: options.provider,
            ...(options.reloadService ? { reloadService: options.reloadService } : {}),
            ...(options.hydrator ? { hydrator: options.hydrator } : {}),
          })
        : undefined);
  }

  async reload(
    request: VersionPersistenceReloadRequest,
  ): Promise<VersionPersistenceReloadResult<TMaterialized>> {
    if (!this.materializationService) {
      return versionPersistenceReloadServiceUnavailable<TMaterialized>();
    }

    const materialized = await this.materializationService.materializeSnapshotRoot(request);
    if (!materialized.ok) {
      return versionPersistenceReloadMaterializationFailure(materialized);
    }

    return Object.freeze({
      ok: true as const,
      reload: 'fresh-lifecycle' as const,
      materialization: materialized.materialization,
      commitId: materialized.commitId,
      snapshotRootDigest: materialized.snapshotRootDigest,
      snapshotRootRecord: materialized.snapshotRootRecord,
      materialized: materialized.materialized,
      decodedByteLength: materialized.decodedByteLength,
      diagnostics: [],
      mutationGuarantee: 'no-current-workbook-mutation' as const,
    });
  }

  async persistBoundary(
    request: VersionPersistenceBoundaryRequest,
  ): Promise<VersionPersistenceBoundaryResult> {
    return persistVersionPersistenceBoundary(this.provider, request);
  }
}

export function createVersionPersistence<TMaterialized = unknown>(
  options: VersionPersistenceOptions<TMaterialized> = {},
): VersionPersistence<TMaterialized> {
  return new VersionPersistence(options);
}
