import type { DocumentContext } from '../../context';
import { createProviderBackedCheckoutMaterializationService } from '../../document/version-store/checkout-provider-service';
import { createWorkbookVersionCommitService } from '../../document/version-store/commit-service';
import { createWorkbookVersionDiffService } from '../../document/version-store/diff-service';
import { createWorkbookVersionMergeService } from '../../document/version-store/merge-service';
import type { WorkbookVersioningConfig } from './types';

type MutableVersioningContext = DocumentContext & {
  versioning?: unknown;
};

export function attachWorkbookVersioning(
  ctx: DocumentContext,
  config: WorkbookVersioningConfig,
): void {
  const writeService =
    config.writeService ??
    (config.provider
      ? createWorkbookVersionCommitService({
          provider: config.provider,
          captureNormalCommit: config.captureNormalCommit,
          snapshotRootByteSyncPort: config.snapshotRootByteSyncPort,
        })
      : undefined);
  if (!writeService) return;

  const runtime = ctx as MutableVersioningContext;
  const existing = isRecord(runtime.versioning) ? runtime.versioning : {};
  const diffService =
    existing.diffService ??
    existing.versionDiffService ??
    (config.provider ? createWorkbookVersionDiffService({ provider: config.provider }) : undefined);
  const checkoutService =
    existing.checkoutService ??
    existing.checkoutMaterializationService ??
    (config.provider
      ? createProviderBackedCheckoutMaterializationService({
          provider: config.provider,
          ...(config.checkoutSnapshotMaterializer
            ? { snapshotMaterializer: config.checkoutSnapshotMaterializer }
            : {}),
        })
      : undefined);
  const mergeService =
    config.mergeService ??
    existing.mergeService ??
    existing.versionMergeService ??
    (config.provider ? createWorkbookVersionMergeService({ provider: config.provider }) : undefined);
  runtime.versioning = {
    ...existing,
    ...(config.provider ? { provider: config.provider } : {}),
    writeService,
    readService: existing.readService ?? writeService,
    ...(diffService ? { diffService } : {}),
    ...(checkoutService ? { checkoutService } : {}),
    ...(mergeService ? { mergeService } : {}),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
