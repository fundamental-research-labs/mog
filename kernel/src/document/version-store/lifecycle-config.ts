import { createSemanticMutationCapture } from './semantic-mutation-capture';
import type { ResolvedWorkbookVersioningConfig } from './lifecycle-types';

export function domainSupportManifestLifecycleFields(
  config: ResolvedWorkbookVersioningConfig,
): Pick<
  ResolvedWorkbookVersioningConfig,
  | 'domainSupportManifest'
  | 'readDomainSupportManifest'
  | 'domainSupportManifestOptions'
  | 'requireDomainSupportManifest'
> {
  return {
    ...(config.domainSupportManifest !== undefined
      ? { domainSupportManifest: config.domainSupportManifest }
      : {}),
    ...(config.readDomainSupportManifest
      ? { readDomainSupportManifest: config.readDomainSupportManifest }
      : {}),
    ...(config.domainSupportManifestOptions
      ? { domainSupportManifestOptions: config.domainSupportManifestOptions }
      : {}),
    ...(config.requireDomainSupportManifest !== undefined
      ? { requireDomainSupportManifest: config.requireDomainSupportManifest }
      : {}),
  };
}

export function resolveSemanticMutationCapture(
  config: ResolvedWorkbookVersioningConfig,
): ResolvedWorkbookVersioningConfig {
  const semanticMutationCapture =
    config.semanticMutationCapture ??
    (!config.captureNormalCommit && config.provider && config.snapshotRootByteSyncPort
      ? createSemanticMutationCapture({
          semanticStateReader: config.semanticStateReader,
          requireOperationContext: true,
        })
      : undefined);
  return semanticMutationCapture === config.semanticMutationCapture
    ? config
    : { ...config, semanticMutationCapture };
}
