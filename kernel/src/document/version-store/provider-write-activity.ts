export type VersionProviderWriteActivitySnapshot = {
  readonly remoteSyncApplyActiveCount: number;
  readonly pendingRemotePromotionActiveCount: number;
  readonly pendingRemotePromotionQueuedCount: number;
  readonly statusRevision: string;
};

export type VersionProviderWriteActivityTracker = {
  readActivity(): VersionProviderWriteActivitySnapshot;
  trackRemoteSyncApply<T>(operation: () => Promise<T>): Promise<T>;
  runExclusivePendingRemotePromotion<T>(operation: () => Promise<T>): Promise<T>;
};

export function createVersionProviderWriteActivityTracker(): VersionProviderWriteActivityTracker {
  let remoteSyncApplyActiveCount = 0;
  let pendingRemotePromotionActiveCount = 0;
  let pendingRemotePromotionQueuedCount = 0;
  let revision = 0;
  let promotionTail: Promise<void> = Promise.resolve();

  const bumpRevision = () => {
    revision += 1;
  };

  const readActivity = (): VersionProviderWriteActivitySnapshot =>
    Object.freeze({
      remoteSyncApplyActiveCount,
      pendingRemotePromotionActiveCount,
      pendingRemotePromotionQueuedCount,
      statusRevision: [
        `revision:${revision}`,
        `remoteSyncApply:${remoteSyncApplyActiveCount}`,
        `pendingRemotePromotion:${pendingRemotePromotionActiveCount}`,
        `queuedPendingRemotePromotion:${pendingRemotePromotionQueuedCount}`,
      ].join('|'),
    });

  return {
    readActivity,

    async trackRemoteSyncApply<T>(operation: () => Promise<T>): Promise<T> {
      remoteSyncApplyActiveCount += 1;
      bumpRevision();
      try {
        return await operation();
      } finally {
        remoteSyncApplyActiveCount = Math.max(0, remoteSyncApplyActiveCount - 1);
        bumpRevision();
      }
    },

    runExclusivePendingRemotePromotion<T>(operation: () => Promise<T>): Promise<T> {
      pendingRemotePromotionQueuedCount += 1;
      bumpRevision();

      const run = promotionTail.then(async () => {
        pendingRemotePromotionQueuedCount = Math.max(0, pendingRemotePromotionQueuedCount - 1);
        pendingRemotePromotionActiveCount += 1;
        bumpRevision();
        try {
          return await operation();
        } finally {
          pendingRemotePromotionActiveCount = Math.max(0, pendingRemotePromotionActiveCount - 1);
          bumpRevision();
        }
      });

      promotionTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

export function isVersionProviderWriteActivityTracker(
  value: unknown,
): value is VersionProviderWriteActivityTracker {
  return (
    isRecord(value) &&
    typeof value.readActivity === 'function' &&
    typeof value.trackRemoteSyncApply === 'function' &&
    typeof value.runExclusivePendingRemotePromotion === 'function'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
