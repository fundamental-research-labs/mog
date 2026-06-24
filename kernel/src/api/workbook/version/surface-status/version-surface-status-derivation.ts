import type { DocumentContext } from '../../../../context';
import { deriveDomainSupportCapabilityBlocks } from './version-surface-status-derivation-domain-support';
import { getVersionSurfaceOperationFeatureGates } from './version-surface-status-derivation-feature-gates';
import { deriveLowerGateCapabilityBlocks } from './version-surface-status-derivation-lower-gates';
import { deriveProviderCapabilityBlocks } from './version-surface-status-derivation-provider';
import { deriveSemanticCaptureCapabilityBlocks } from './version-surface-status-derivation-semantic-capture';
import type {
  VersionSurfaceCapabilityAvailability,
  VersionSurfaceCapabilityBlocks,
} from './version-surface-status-derivation-types';

export { getVersionSurfaceOperationFeatureGates };
export type {
  VersionSurfaceCapabilityAvailability,
  VersionSurfaceCapabilityBlock,
  VersionSurfaceCapabilityBlocks,
  VersionSurfaceOperationFeatureGates,
} from './version-surface-status-derivation-types';

export async function deriveVersionSurfaceCapabilityBlocks(input: {
  readonly ctx: DocumentContext;
  readonly services: unknown;
  readonly availability: VersionSurfaceCapabilityAvailability;
}): Promise<VersionSurfaceCapabilityBlocks> {
  const blocks: VersionSurfaceCapabilityBlocks = {
    ...deriveProviderCapabilityBlocks(input.services, input.availability),
  };
  const domainBlocks = await deriveDomainSupportCapabilityBlocks(input.ctx, input.availability);
  return {
    ...blocks,
    ...deriveSemanticCaptureCapabilityBlocks(input.services, input.availability),
    ...domainBlocks,
    ...deriveLowerGateCapabilityBlocks(input.ctx, input.services, input.availability),
  };
}
