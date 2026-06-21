import type { DocumentContext } from '../../context';
import { createProviderBackedBranchLifecycleService } from '../../document/version-store/branch-provider-service';
import { createProviderBackedCheckoutMaterializationService } from '../../document/version-store/checkout-provider-service';
import { createWorkbookVersionCommitService } from '../../document/version-store/commit-service';
import { createWorkbookVersionDiffService } from '../../document/version-store/diff-service';
import { createWorkbookVersionMergeService } from '../../document/version-store/merge-service';
import { createSemanticMutationCapture } from '../../document/version-store/semantic-mutation-capture';
import type { WorkbookVersioningConfig } from './types';

type MutableVersioningContext = DocumentContext & {
  versioning?: unknown;
};

export function attachWorkbookVersioning(
  ctx: DocumentContext,
  config: WorkbookVersioningConfig,
): void {
  const runtime = ctx as MutableVersioningContext;
  const existing = isRecord(runtime.versioning) ? runtime.versioning : {};
  const semanticCapture =
    !config.captureNormalCommit && config.provider && config.snapshotRootByteSyncPort
      ? createSemanticMutationCapture()
      : undefined;
  const captureNormalCommit = config.captureNormalCommit ?? semanticCapture?.captureNormalCommit;
  const writeService =
    config.writeService ??
    (config.provider
      ? createWorkbookVersionCommitService({
          provider: config.provider,
          captureNormalCommit,
          captureMergeCommit: config.captureMergeCommit,
          snapshotRootByteSyncPort: config.snapshotRootByteSyncPort,
        })
      : undefined);
  if (!writeService) return;

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
  const branchService =
    existing.branchService ??
    existing.branchRefService ??
    existing.refLifecycleService ??
    (config.provider
      ? createProviderBackedBranchLifecycleService({ provider: config.provider })
      : undefined);
  runtime.versioning = {
    ...existing,
    ...(config.provider ? { provider: config.provider } : {}),
    writeService,
    readService: existing.readService ?? writeService,
    ...(semanticCapture ? { mutationCapture: semanticCapture.mutationCapture } : {}),
    ...(diffService ? { diffService } : {}),
    ...(checkoutService ? { checkoutService } : {}),
    ...(mergeService ? { mergeService } : {}),
    ...(branchService ? { branchService } : {}),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
