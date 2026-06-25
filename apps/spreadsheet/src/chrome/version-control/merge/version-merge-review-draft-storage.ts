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

type VersionMergeReviewDraftRead = {
  readonly key: string;
  readonly draft: VersionMergeReviewDraft;
};

const MERGE_REVIEW_DRAFT_STORAGE_PREFIX = 'mog.versionHistory.mergeReviewDraft.v1';
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const VERSION_MAIN_BRANCH = 'main';
const VERSION_MAIN_REF = 'refs/heads/main';

export function mergeReviewDraftStorageKey(target: VersionMergeTarget, source: VersionRef): string {
  return mergeReviewDraftStorageKeyForRefName(
    target.commitId,
    canonicalMergeReviewRefName(target.refName),
    source,
  );
}

function mergeReviewDraftStorageKeys(
  target: VersionMergeTarget,
  source: VersionRef,
): readonly string[] {
  return [...mergeReviewDraftTargetRefAliases(target.refName)].map((targetRefName) =>
    mergeReviewDraftStorageKeyForRefName(target.commitId, targetRefName, source),
  );
}

function mergeReviewDraftStorageKeyForRefName(
  targetCommitId: WorkbookCommitId,
  targetRefName: string | undefined,
  source: VersionRef,
): string {
  return [
    MERGE_REVIEW_DRAFT_STORAGE_PREFIX,
    targetRefName ?? 'detached',
    targetCommitId,
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
  const targetRefName = canonicalMergeReviewRefName(target.refName);
  const value: VersionMergeReviewDraft = {
    schemaVersion: 1,
    input: draft.input,
    sourceRefName: source.name,
    ...(targetRefName ? { targetRefName } : {}),
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

export function readMergeReviewDraftForTarget(
  target: VersionMergeTarget,
  source: VersionRef,
): VersionMergeReviewDraftRead | null {
  for (const key of mergeReviewDraftStorageKeys(target, source)) {
    const draft = readMergeReviewDraft(key);
    if (!draft) continue;
    if (mergeReviewDraftMatches(draft, target, source)) return { key, draft };
  }
  return null;
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

export function clearMergeReviewDraftForTarget(
  target: VersionMergeTarget,
  source: VersionRef,
): void {
  for (const key of mergeReviewDraftStorageKeys(target, source)) {
    clearMergeReviewDraft(key);
  }
}

export function mergeReviewDraftMatches(
  draft: VersionMergeReviewDraft,
  target: VersionMergeTarget,
  source: VersionRef,
): boolean {
  const draftTargetRefName = canonicalMergeReviewRefName(draft.targetRefName);
  const targetRefName = canonicalMergeReviewRefName(target.refName);
  return (
    draft.input.ours === target.commitId &&
    draft.input.theirs === source.commitId &&
    draft.sourceRefName === source.name &&
    (draftTargetRefName ?? undefined) === (targetRefName ?? undefined)
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

function canonicalMergeReviewRefName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === VERSION_MAIN_BRANCH) return VERSION_MAIN_REF;
  if (value.startsWith(VERSION_BRANCH_REF_PREFIX)) return value;
  if (value.startsWith('refs/')) return value;
  return `${VERSION_BRANCH_REF_PREFIX}${value}`;
}

function mergeReviewDraftTargetRefAliases(
  value: string | undefined,
): ReadonlySet<string | undefined> {
  const aliases = new Set<string | undefined>();
  const canonical = canonicalMergeReviewRefName(value);
  aliases.add(canonical);
  if (value && value !== canonical) aliases.add(value);
  if (canonical?.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    aliases.add(canonical.slice(VERSION_BRANCH_REF_PREFIX.length));
  }
  return aliases;
}
