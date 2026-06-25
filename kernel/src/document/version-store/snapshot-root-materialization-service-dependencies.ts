import type { CheckoutMaterializationResult } from './checkout-service';
import type { VersionDependencyRef } from './object-digest';
import { cloneDigest } from './snapshot-root-materialization-service-utils';

type SnapshotRootMaterializationPlan = Extract<
  CheckoutMaterializationResult,
  { ok: true; materialization: 'planned' }
>['plan'];

export function snapshotRootDependency(
  plan: SnapshotRootMaterializationPlan,
): VersionDependencyRef {
  const dependency = plan.requiredDependencies.find((entry) => entry.role === 'snapshotRoot');
  return Object.freeze({
    kind: 'object',
    objectType: dependency?.objectType ?? 'workbook.snapshotRoot.v1',
    digest: cloneDigest(dependency?.digest ?? plan.snapshotRootDigest),
  });
}
