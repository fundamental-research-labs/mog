import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeInput,
  VersionMergeOptions,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { mapPublicExpectedTargetHead } from './version-attempt-metadata';
import { mapPublicApplyTargetRef } from './version/apply-merge/target-ref/version-apply-merge-target-ref';
import { invalidMergeOptionDiagnostic } from './version-merge-public-diagnostics';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_MERGE_INPUT_KEYS = new Set(['base', 'ours', 'theirs']);
const VERSION_MERGE_OPTION_KEYS = new Set([
  'mode',
  'includeDiagnostics',
  'targetRef',
  'expectedTargetHead',
  'persistReviewRecord',
]);

export type MergeValidationResult =
  | {
      readonly ok: true;
      readonly input: VersionMergeInput;
      readonly options: VersionMergeOptions;
    }
  | {
      readonly ok: false;
      readonly base: WorkbookCommitId | null;
      readonly ours: WorkbookCommitId | null;
      readonly theirs: WorkbookCommitId | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export function validateMergeRequest(
  input: VersionMergeInput,
  options: VersionMergeOptions,
): MergeValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];

  const normalizedInput = normalizeMergeInput(input, diagnostics);
  const normalizedOptions = normalizeMergeOptions(options, diagnostics);

  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    return {
      ok: false,
      base: normalizedInput?.base ?? toCommitId(isRecord(input) ? input.base : undefined),
      ours: normalizedInput?.ours ?? toCommitId(isRecord(input) ? input.ours : undefined),
      theirs: normalizedInput?.theirs ?? toCommitId(isRecord(input) ? input.theirs : undefined),
      diagnostics,
    };
  }

  if (
    normalizedOptions.expectedTargetHead !== undefined &&
    normalizedOptions.expectedTargetHead.commitId !== normalizedInput.ours
  ) {
    diagnostics.push(
      invalidMergeOptionDiagnostic(
        'expectedTargetHead.commitId',
        'expectedTargetHead.commitId must match the merge ours commit.',
      ),
    );
  }
  if (diagnostics.length > 0) {
    return {
      ok: false,
      base: normalizedInput.base,
      ours: normalizedInput.ours,
      theirs: normalizedInput.theirs,
      diagnostics,
    };
  }

  return { ok: true, input: normalizedInput, options: normalizedOptions };
}

function normalizeMergeInput(
  input: VersionMergeInput,
  diagnostics: VersionStoreDiagnostic[],
): VersionMergeInput | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidMergeOptionDiagnostic('input', 'merge input must be an object with commit ids.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_MERGE_INPUT_KEYS.has(key)) continue;
    diagnostics.push(invalidMergeOptionDiagnostic(`input.${key}`, `Unknown merge input "${key}".`));
  }

  const base = toCommitId(input.base);
  const ours = toCommitId(input.ours);
  const theirs = toCommitId(input.theirs);
  if (!base) {
    diagnostics.push(invalidMergeOptionDiagnostic('base', 'merge base must be a commit id.'));
  }
  if (!ours) {
    diagnostics.push(invalidMergeOptionDiagnostic('ours', 'merge ours must be a commit id.'));
  }
  if (!theirs) {
    diagnostics.push(invalidMergeOptionDiagnostic('theirs', 'merge theirs must be a commit id.'));
  }

  return base && ours && theirs ? { base, ours, theirs } : null;
}

function normalizeMergeOptions(
  input: VersionMergeOptions,
  diagnostics: VersionStoreDiagnostic[],
): VersionMergeOptions | null {
  if (input === undefined) return {};
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidMergeOptionDiagnostic('options', 'merge options must be an object when supplied.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_MERGE_OPTION_KEYS.has(key)) continue;
    diagnostics.push(invalidMergeOptionDiagnostic(key, `Unknown merge option "${key}".`));
  }

  const options: {
    mode?: 'preview';
    includeDiagnostics?: boolean;
    targetRef?: VersionMainRefName | VersionRefName;
    expectedTargetHead?: VersionCommitExpectedHead;
    persistReviewRecord?: boolean;
  } = {};
  if (input.mode !== undefined) {
    if (input.mode !== 'preview') {
      diagnostics.push(
        invalidMergeOptionDiagnostic('mode', 'merge mode must be "preview" when supplied.'),
      );
    } else {
      options.mode = input.mode;
    }
  }

  if (input.includeDiagnostics !== undefined) {
    if (typeof input.includeDiagnostics !== 'boolean') {
      diagnostics.push(
        invalidMergeOptionDiagnostic('includeDiagnostics', 'includeDiagnostics must be a boolean.'),
      );
    } else {
      options.includeDiagnostics = input.includeDiagnostics;
    }
  }

  if (input.targetRef !== undefined) {
    const targetRef = mapPublicApplyTargetRef(input.targetRef);
    if (!targetRef) {
      diagnostics.push(
        invalidMergeOptionDiagnostic(
          'targetRef',
          'targetRef must name main or a valid public branch.',
        ),
      );
    } else {
      options.targetRef = targetRef;
    }
  }

  if (input.expectedTargetHead !== undefined) {
    const expectedTargetHead = mapPublicExpectedTargetHead(input.expectedTargetHead);
    if (!expectedTargetHead) {
      diagnostics.push(
        invalidMergeOptionDiagnostic(
          'expectedTargetHead',
          'expectedTargetHead must be a valid expected head record.',
        ),
      );
    } else {
      options.expectedTargetHead = expectedTargetHead;
    }
  }

  if (input.persistReviewRecord !== undefined) {
    if (typeof input.persistReviewRecord !== 'boolean') {
      diagnostics.push(
        invalidMergeOptionDiagnostic(
          'persistReviewRecord',
          'persistReviewRecord must be a boolean.',
        ),
      );
    } else {
      options.persistReviewRecord = input.persistReviewRecord;
    }
  }

  return options;
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
