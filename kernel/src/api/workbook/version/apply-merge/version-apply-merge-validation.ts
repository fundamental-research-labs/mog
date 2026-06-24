import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeInput,
  VersionMergeOptions,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { validateRefName } from '../../../../document/version-store/refs/ref-name';
import { invalidApplyMergeOptionDiagnostic, publicDiagnostic } from './version-apply-merge-results';
import {
  VERSION_BRANCH_REF_PREFIX,
  VERSION_MAIN_REF,
  isApplyTargetRefName,
} from './target-ref/version-apply-merge-target-ref';
import { normalizeVersionApplyMergeResolutions } from '../../version-merge-resolution-normalization';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_APPLY_MERGE_INPUT_KEYS = new Set(['base', 'ours', 'theirs', 'resolutions']);
const VERSION_APPLY_MERGE_OPTION_KEYS = new Set([
  'mode',
  'targetRef',
  'expectedTargetHead',
  'includeDiagnostics',
  'materializeActiveCheckout',
]);
const VERSION_APPLY_MERGE_EXPECTED_HEAD_KEYS = new Set([
  'commitId',
  'revision',
  'symbolicHeadRevision',
]);
const VERSION_HEAD_REF = 'HEAD';

export type ApplyMergeValidationResult =
  | {
      readonly ok: true;
      readonly mergeInput: VersionMergeInput;
      readonly resolutions: readonly VersionApplyMergeResolution[];
      readonly previewOptions: VersionMergeOptions;
      readonly applyOptions: NormalizedApplyMergeOptions;
    }
  | {
      readonly ok: false;
      readonly base: WorkbookCommitId | null;
      readonly ours: WorkbookCommitId | null;
      readonly theirs: WorkbookCommitId | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type NormalizedApplyMergeOptions =
  | {
      readonly mode: 'preview';
      readonly includeDiagnostics?: boolean;
    }
  | {
      readonly mode: 'apply';
      readonly includeDiagnostics?: boolean;
      readonly targetRef: VersionMainRefName | VersionRefName;
      readonly expectedTargetHead: VersionCommitExpectedHead;
      readonly materializeActiveCheckout?: boolean;
    };

export function isApplyMergePersistedInput(
  input: VersionApplyMergeInput,
): input is VersionApplyMergeInput & Readonly<Record<string, unknown>> {
  return isRecord(input) && 'resultId' in input;
}

export function validateApplyMergeRequest(
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions,
): ApplyMergeValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedInput = normalizeApplyMergeInput(input, diagnostics);
  const normalizedOptions = normalizeApplyMergeOptions(options, diagnostics);

  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    const inputRecord = isRecord(input) ? (input as Readonly<Record<string, unknown>>) : null;
    return {
      ok: false,
      base: normalizedInput?.mergeInput.base ?? toCommitId(inputRecord?.base),
      ours: normalizedInput?.mergeInput.ours ?? toCommitId(inputRecord?.ours),
      theirs: normalizedInput?.mergeInput.theirs ?? toCommitId(inputRecord?.theirs),
      diagnostics,
    };
  }

  return {
    ok: true,
    mergeInput: normalizedInput.mergeInput,
    resolutions: normalizedInput.resolutions,
    previewOptions: {
      mode: 'preview',
      ...(normalizedOptions.includeDiagnostics === undefined
        ? {}
        : { includeDiagnostics: normalizedOptions.includeDiagnostics }),
    },
    applyOptions: normalizedOptions,
  };
}

function normalizeApplyMergeInput(
  input: VersionApplyMergeInput,
  diagnostics: VersionStoreDiagnostic[],
): Pick<
  Extract<ApplyMergeValidationResult, { readonly ok: true }>,
  'mergeInput' | 'resolutions'
> | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('input', 'applyMerge input must be an object.'),
    );
    return null;
  }
  const inputRecord = input as Readonly<Record<string, unknown>>;

  for (const key of Object.keys(inputRecord)) {
    if (VERSION_APPLY_MERGE_INPUT_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`input.${key}`, `Unknown applyMerge input "${key}".`),
    );
  }

  const base = toCommitId(inputRecord.base);
  const ours = toCommitId(inputRecord.ours);
  const theirs = toCommitId(inputRecord.theirs);
  if (!base)
    diagnostics.push(invalidApplyMergeOptionDiagnostic('base', 'base must be a commit id.'));
  if (!ours)
    diagnostics.push(invalidApplyMergeOptionDiagnostic('ours', 'ours must be a commit id.'));
  if (!theirs) {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('theirs', 'theirs must be a commit id.'));
  }

  const resolutions = normalizeResolutions(inputRecord.resolutions, diagnostics);
  return base && ours && theirs && resolutions
    ? { mergeInput: { base, ours, theirs }, resolutions }
    : null;
}

function normalizeResolutions(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): readonly VersionApplyMergeResolution[] | null {
  return normalizeVersionApplyMergeResolutions(value, diagnostics, {
    allowUndefined: true,
    invalidDiagnostic: invalidApplyMergeOptionDiagnostic,
  });
}

function normalizeApplyMergeOptions(
  input: VersionApplyMergeOptions,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedApplyMergeOptions | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('options', 'applyMerge options must be an object.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_OPTION_KEYS.has(key)) continue;
    diagnostics.push(invalidApplyMergeOptionDiagnostic(key, `Unknown applyMerge option "${key}".`));
  }

  let mode: 'preview' | 'apply' = 'apply';
  if (input.mode !== undefined) {
    if (input.mode === 'preview' || input.mode === 'apply') {
      mode = input.mode;
    } else {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic('mode', 'applyMerge mode must be "preview" or "apply".'),
      );
    }
  }
  const baseOptions: { mode: 'preview' | 'apply'; includeDiagnostics?: boolean } = { mode };

  if (input.includeDiagnostics !== undefined) {
    if (typeof input.includeDiagnostics !== 'boolean') {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'includeDiagnostics',
          'includeDiagnostics must be a boolean.',
        ),
      );
    } else {
      baseOptions.includeDiagnostics = input.includeDiagnostics;
    }
  }

  let materializeActiveCheckout: boolean | undefined;
  if (input.materializeActiveCheckout !== undefined) {
    if (typeof input.materializeActiveCheckout !== 'boolean') {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'materializeActiveCheckout',
          'materializeActiveCheckout must be a boolean.',
        ),
      );
    } else {
      materializeActiveCheckout = input.materializeActiveCheckout;
    }
  }

  if (mode === 'preview') {
    if (input.targetRef !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic('targetRef', 'targetRef is valid only in apply mode.'),
      );
    }
    if (input.expectedTargetHead !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'expectedTargetHead',
          'expectedTargetHead is valid only in apply mode.',
        ),
      );
    }
    if (materializeActiveCheckout !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'materializeActiveCheckout',
          'materializeActiveCheckout is valid only in apply mode.',
        ),
      );
    }
    return diagnostics.length === 0 ? { ...baseOptions, mode: 'preview' } : null;
  }

  const targetRef = validateTargetRef(input.targetRef, diagnostics);
  const expectedTargetHead = validateExpectedTargetHead(input.expectedTargetHead, diagnostics);
  return diagnostics.length === 0 && targetRef && expectedTargetHead
    ? {
        ...baseOptions,
        mode: 'apply',
        targetRef,
        expectedTargetHead,
        ...(materializeActiveCheckout === undefined ? {} : { materializeActiveCheckout }),
      }
    : null;
}

function validateTargetRef(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('targetRef', 'targetRef is required.'));
    return undefined;
  }
  if (value === VERSION_HEAD_REF) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'targetRef',
        'targetRef must be a concrete refs/heads/* ref.',
      ),
    );
    return undefined;
  }

  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) {
    diagnostics.push(
      ...parsed.diagnostics.map((item) =>
        publicDiagnostic(
          'VERSION_INVALID_OPTIONS',
          'targetRef must name a public-safe version branch.',
          {
            recoverability: 'none',
            payload: { option: 'targetRef', issue: item.issue, refName: 'redacted' },
          },
        ),
      ),
    );
    return undefined;
  }

  const targetRef =
    parsed.name === 'main'
      ? VERSION_MAIN_REF
      : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
  if (!isApplyTargetRefName(targetRef)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'targetRef',
        'targetRef must name main or a valid public branch.',
      ),
    );
    return undefined;
  }
  return targetRef;
}

function validateExpectedTargetHead(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionCommitExpectedHead | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead',
        'expectedTargetHead is required in apply mode.',
      ),
    );
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (VERSION_APPLY_MERGE_EXPECTED_HEAD_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `expectedTargetHead.${key}`,
        `Unknown expectedTargetHead field "${key}".`,
      ),
    );
  }

  const commitId = toCommitId(value.commitId);
  const revision = toPublicRevision(value.revision);
  const symbolicHeadRevision =
    value.symbolicHeadRevision === undefined
      ? undefined
      : toPublicRevision(value.symbolicHeadRevision);

  if (!commitId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead.commitId',
        'expectedTargetHead.commitId is invalid.',
      ),
    );
  }
  if (!revision) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead.revision',
        'expectedTargetHead.revision is invalid.',
      ),
    );
  }
  if ('symbolicHeadRevision' in value && !symbolicHeadRevision) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead.symbolicHeadRevision',
        'expectedTargetHead.symbolicHeadRevision is invalid.',
      ),
    );
  }
  return commitId && revision && (!('symbolicHeadRevision' in value) || symbolicHeadRevision)
    ? {
        commitId,
        revision,
        ...(symbolicHeadRevision ? { symbolicHeadRevision } : {}),
      }
    : undefined;
}

function toPublicRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  if (typeof value === 'string') return { kind: 'opaque', value };
  return undefined;
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
