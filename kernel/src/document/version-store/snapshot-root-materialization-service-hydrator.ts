import type { SnapshotRootFreshLifecycleHydrator } from './snapshot-root-reload-service';

export function requiredHydrator<TMaterialized>(
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
