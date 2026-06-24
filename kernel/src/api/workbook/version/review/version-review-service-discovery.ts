type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export function hasAttachedVersionReviewReadService(services: unknown): boolean {
  return reviewServiceCandidates(services).some((candidate) =>
    Boolean(
      bindMethod(candidate, 'listReviews') ??
      bindMethod(candidate, 'getReview') ??
      bindMethod(candidate, 'getReviewDiff'),
    ),
  );
}

export function hasAttachedVersionReviewWriteService(services: unknown): boolean {
  return reviewServiceCandidates(services).some((candidate) =>
    Boolean(
      bindMethod(candidate, 'createReview') ??
      bindMethod(candidate, 'appendReviewDecision') ??
      bindMethod(candidate, 'updateReviewStatus'),
    ),
  );
}

function reviewServiceCandidates(services: unknown): readonly unknown[] {
  if (!isRecord(services)) return [];
  return [
    services.publicService,
    services.reviewService,
    services.versionReviewService,
    services.reviewRecordService,
    services.reviewMetadataStore,
    services,
  ];
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
