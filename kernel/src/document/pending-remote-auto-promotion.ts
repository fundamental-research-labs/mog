import { slog } from '../lib/slog';
import type {
  PendingRemotePromotionResult,
  PendingRemotePromotionService,
} from './version-store/pending-remote-promotion-service';
import { createPendingRemotePromotionService } from './version-store/pending-remote-promotion-service';
import type { VersionProviderWriteActivityTracker } from './version-store/provider-write-activity';
import type { VersionStoreProvider } from './version-store/provider';

export type PendingRemotePromotionServiceLike = Pick<
  PendingRemotePromotionService,
  'promotePendingRemoteSegments'
>;

export type ResolvedPendingRemotePromotionService = {
  readonly service?: PendingRemotePromotionServiceLike;
  readonly provider?: VersionStoreProvider;
  readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
};

export function resolvePendingRemotePromotionService(input: {
  readonly explicit?: PendingRemotePromotionServiceLike | undefined;
  readonly provider: VersionStoreProvider;
  readonly providerWriteActivityTracker: VersionProviderWriteActivityTracker;
  readonly existing?: PendingRemotePromotionServiceLike | undefined;
  readonly existingProvider?: VersionStoreProvider | undefined;
  readonly existingProviderWriteActivityTracker?: VersionProviderWriteActivityTracker | undefined;
}): ResolvedPendingRemotePromotionService {
  if (input.explicit) {
    return { service: input.explicit };
  }
  if (
    input.existing &&
    input.existingProvider === input.provider &&
    input.existingProviderWriteActivityTracker === input.providerWriteActivityTracker
  ) {
    return {
      service: input.existing,
      provider: input.provider,
      providerWriteActivityTracker: input.providerWriteActivityTracker,
    };
  }
  return {
    service: createPendingRemotePromotionService({
      provider: input.provider,
      providerWriteActivityTracker: input.providerWriteActivityTracker,
    }),
    provider: input.provider,
    providerWriteActivityTracker: input.providerWriteActivityTracker,
  };
}

export async function promoteCapturedPendingRemoteSegment(input: {
  readonly updateId: string;
  readonly captured: boolean;
  readonly service?: PendingRemotePromotionServiceLike | undefined;
}): Promise<PendingRemotePromotionResult | undefined> {
  if (!input.captured) return undefined;
  if (!input.service) {
    slog('rustDocument.applyProviderUpdatePendingRemotePromotionUnavailable', {
      updateId: input.updateId,
    });
    return undefined;
  }

  try {
    const result = await input.service.promotePendingRemoteSegments();
    if (result.status !== 'success') {
      slog('rustDocument.applyProviderUpdatePendingRemotePromotionIncomplete', {
        updateId: input.updateId,
        status: result.status,
        promotedSegmentCount: result.promotedSegmentIds.length,
        skippedSegmentCount: result.skipped.length,
        diagnostics: result.diagnostics,
      });
    }
    return result;
  } catch (error) {
    slog('rustDocument.applyProviderUpdatePendingRemotePromotionFailed', {
      updateId: input.updateId,
      error,
    });
    return undefined;
  }
}
