import type {
  VersionMergeInput,
  VersionMergeResult,
  VersionRef,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

type VersionMergeTarget = {
  readonly commitId: WorkbookCommitId;
  readonly refName?: string;
};

type VersionMergeResolutionSelections = Readonly<Record<string, string>>;

type VersionMergeReviewDraft = {
  readonly schemaVersion: 1;
  readonly input: VersionMergeInput;
  readonly sourceRefName: string;
  readonly targetRefName?: string;
  readonly selections: VersionMergeResolutionSelections;
  readonly updatedAt: number;
};

const MERGE_REVIEW_DRAFT_STORAGE_PREFIX = 'mog.versionHistory.mergeReviewDraft.v1';

export function mergeReviewDraftStorageKey(
  target: VersionMergeTarget,
  source: VersionRef,
): string {
  return [
    MERGE_REVIEW_DRAFT_STORAGE_PREFIX,
    target.refName ?? 'detached',
    target.commitId,
    source.name,
    source.commitId,
  ]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

export function writeMergeReviewDraft(
  target: VersionMergeTarget,
  source: VersionRef,
  draft: Pick<VersionMergeReviewDraft, 'input' | 'selections'>,
): void {
  const storage = mergeReviewDraftStorage();
  if (!storage) return;
  const value: VersionMergeReviewDraft = {
    schemaVersion: 1,
    input: draft.input,
    sourceRefName: source.name,
    ...(target.refName ? { targetRefName: target.refName } : {}),
    selections: draft.selections,
    updatedAt: Date.now(),
  };
  try {
    storage.setItem(mergeReviewDraftStorageKey(target, source), JSON.stringify(value));
  } catch {
    // Session storage is an optimization; merge preview/apply still works without it.
  }
}

export function readMergeReviewDraft(key: string): VersionMergeReviewDraft | null {
  const storage = mergeReviewDraftStorage();
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isMergeReviewDraft(parsed) ? parsed : null;
  } catch {
    clearMergeReviewDraft(key);
    return null;
  }
}

export function clearMergeReviewDraft(key: string): void {
  const storage = mergeReviewDraftStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage failures; stale drafts are validated before use.
  }
}

export function mergeReviewDraftMatches(
  draft: VersionMergeReviewDraft,
  target: VersionMergeTarget,
  source: VersionRef,
): boolean {
  return (
    draft.input.ours === target.commitId &&
    draft.input.theirs === source.commitId &&
    draft.sourceRefName === source.name &&
    (draft.targetRefName ?? undefined) === (target.refName ?? undefined)
  );
}

export function sanitizeMergeReviewDraftSelections(
  result: VersionMergeResult,
  draft: VersionMergeReviewDraft,
): VersionMergeResolutionSelections {
  if (result.status !== 'conflicted') return {};
  const selections: Record<string, string> = {};
  for (const conflict of result.conflicts) {
    const optionId = draft.selections[conflict.conflictId];
    if (conflict.resolutionOptions.some((option) => option.optionId === optionId)) {
      selections[conflict.conflictId] = optionId;
    }
  }
  return selections;
}

function mergeReviewDraftStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isMergeReviewDraft(value: unknown): value is VersionMergeReviewDraft {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.input)) return false;
  if (
    typeof value.input.base !== 'string' ||
    typeof value.input.ours !== 'string' ||
    typeof value.input.theirs !== 'string' ||
    typeof value.sourceRefName !== 'string' ||
    (value.targetRefName !== undefined && typeof value.targetRefName !== 'string') ||
    !isRecord(value.selections) ||
    typeof value.updatedAt !== 'number'
  ) {
    return false;
  }
  return Object.values(value.selections).every((selection) => typeof selection === 'string');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
