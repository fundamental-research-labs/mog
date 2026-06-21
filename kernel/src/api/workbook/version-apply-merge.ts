import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeInput,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { mergeWorkbookVersion } from './version-merge';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_APPLY_MERGE_INPUT_KEYS = new Set(['base', 'ours', 'theirs', 'resolutions']);
const VERSION_APPLY_MERGE_OPTION_KEYS = new Set(['mode', 'includeDiagnostics']);

type ApplyMergeValidationResult =
  | {
      readonly ok: true;
      readonly mergeInput: VersionMergeInput;
      readonly resolutions: readonly VersionApplyMergeResolution[];
      readonly options: VersionApplyMergeOptions;
    }
  | {
      readonly ok: false;
      readonly base: WorkbookCommitId | null;
      readonly ours: WorkbookCommitId | null;
      readonly theirs: WorkbookCommitId | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

type ResolutionPlanResult =
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export async function applyMergeWorkbookVersion(
  ctx: DocumentContext,
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions = {},
): Promise<VersionApplyMergeResult> {
  const validated = validateApplyMergeRequest(input, options);
  if (!validated.ok) {
    return blockedApplyMergeResult(
      validated.base,
      validated.ours,
      validated.theirs,
      validated.diagnostics,
    );
  }

  const preview = await mergeWorkbookVersion(ctx, validated.mergeInput, validated.options);
  if (preview.status === 'blocked') {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, preview.diagnostics);
  }

  if (preview.status === 'clean') {
    if (validated.resolutions.length > 0) {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic('clean merge previews do not accept conflict resolutions.'),
      ]);
    }
    return {
      status: 'planned',
      base: preview.base,
      ours: preview.ours,
      theirs: preview.theirs,
      changes: preview.changes,
      conflicts: [],
      diagnostics: [],
      resolutionCount: 0,
      mutationGuarantee: 'preview-only',
    };
  }

  if (validated.resolutions.length === 0) {
    return {
      status: 'conflicted',
      base: preview.base,
      ours: preview.ours,
      theirs: preview.theirs,
      changes: preview.changes,
      conflicts: preview.conflicts,
      diagnostics: [],
      requiredResolutionCount: preview.conflicts.length,
      mutationGuarantee: 'preview-only',
    };
  }

  const plan = planResolvedConflicts(preview.conflicts, validated.resolutions);
  if (!plan.ok) {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, plan.diagnostics);
  }

  return {
    status: 'planned',
    base: preview.base,
    ours: preview.ours,
    theirs: preview.theirs,
    changes: [...preview.changes, ...plan.changes],
    conflicts: [],
    diagnostics: [],
    resolutionCount: validated.resolutions.length,
    mutationGuarantee: 'preview-only',
  };
}

function validateApplyMergeRequest(
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions,
): ApplyMergeValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedInput = normalizeApplyMergeInput(input, diagnostics);
  const normalizedOptions = normalizeApplyMergeOptions(options, diagnostics);

  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    return {
      ok: false,
      base: normalizedInput?.mergeInput.base ?? toCommitId(isRecord(input) ? input.base : undefined),
      ours: normalizedInput?.mergeInput.ours ?? toCommitId(isRecord(input) ? input.ours : undefined),
      theirs:
        normalizedInput?.mergeInput.theirs ?? toCommitId(isRecord(input) ? input.theirs : undefined),
      diagnostics,
    };
  }

  return {
    ok: true,
    mergeInput: normalizedInput.mergeInput,
    resolutions: normalizedInput.resolutions,
    options: normalizedOptions,
  };
}

function normalizeApplyMergeInput(
  input: VersionApplyMergeInput,
  diagnostics: VersionStoreDiagnostic[],
): Pick<Extract<ApplyMergeValidationResult, { readonly ok: true }>, 'mergeInput' | 'resolutions'> | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('input', 'applyMerge input must be an object.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_INPUT_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`input.${key}`, `Unknown applyMerge input "${key}".`),
    );
  }

  const base = toCommitId(input.base);
  const ours = toCommitId(input.ours);
  const theirs = toCommitId(input.theirs);
  if (!base) diagnostics.push(invalidApplyMergeOptionDiagnostic('base', 'base must be a commit id.'));
  if (!ours) diagnostics.push(invalidApplyMergeOptionDiagnostic('ours', 'ours must be a commit id.'));
  if (!theirs) {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('theirs', 'theirs must be a commit id.'));
  }

  const resolutions = normalizeResolutions(input.resolutions, diagnostics);
  return base && ours && theirs && resolutions
    ? { mergeInput: { base, ours, theirs }, resolutions }
    : null;
}

function normalizeResolutions(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): readonly VersionApplyMergeResolution[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('resolutions', 'resolutions must be an array when supplied.'),
    );
    return null;
  }

  const resolutions: VersionApplyMergeResolution[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    const resolution = normalizeResolution(item, index, diagnostics);
    if (resolution) resolutions.push(resolution);
  }
  return diagnostics.length === 0 ? resolutions : null;
}

function normalizeResolution(
  value: unknown,
  index: number,
  diagnostics: VersionStoreDiagnostic[],
): VersionApplyMergeResolution | null {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}]`,
        'resolution entries must be objects.',
      ),
    );
    return null;
  }

  const keys = new Set(['conflictId', 'expectedConflictDigest', 'optionId', 'kind']);
  for (const key of Object.keys(value)) {
    if (keys.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}].${key}`,
        `Unknown resolution field "${key}".`,
      ),
    );
  }

  const conflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const expectedConflictDigest =
    typeof value.expectedConflictDigest === 'string' ? value.expectedConflictDigest : null;
  const optionId = typeof value.optionId === 'string' ? value.optionId : null;
  const kind =
    value.kind === 'acceptOurs' || value.kind === 'acceptTheirs' || value.kind === 'acceptBase'
      ? value.kind
      : null;

  if (!conflictId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`resolutions[${index}].conflictId`, 'conflictId is required.'),
    );
  }
  if (!expectedConflictDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}].expectedConflictDigest`,
        'expectedConflictDigest is required.',
      ),
    );
  }
  if (!optionId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`resolutions[${index}].optionId`, 'optionId is required.'),
    );
  }
  if (!kind) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}].kind`,
        'resolution kind must be acceptOurs, acceptTheirs, or acceptBase.',
      ),
    );
  }

  return conflictId && expectedConflictDigest && optionId && kind
    ? { conflictId, expectedConflictDigest, optionId, kind }
    : null;
}

function normalizeApplyMergeOptions(
  input: VersionApplyMergeOptions,
  diagnostics: VersionStoreDiagnostic[],
): VersionApplyMergeOptions | null {
  if (input === undefined) return {};
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

  const options: { mode?: 'preview'; includeDiagnostics?: boolean } = {};
  if (input.mode !== undefined) {
    if (input.mode !== 'preview') {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic('mode', 'applyMerge mode must be "preview" when supplied.'),
      );
    } else {
      options.mode = input.mode;
    }
  }

  if (input.includeDiagnostics !== undefined) {
    if (typeof input.includeDiagnostics !== 'boolean') {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic('includeDiagnostics', 'includeDiagnostics must be a boolean.'),
      );
    } else {
      options.includeDiagnostics = input.includeDiagnostics;
    }
  }

  return options;
}

function planResolvedConflicts(
  conflicts: readonly VersionMergeConflict[],
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionPlanResult {
  if (resolutions.length !== conflicts.length) {
    return {
      ok: false,
      diagnostics: [
        resolutionMismatchDiagnostic('applyMerge preview requires exactly one resolution per conflict.'),
      ],
    };
  }

  const conflictsById = new Map(conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const seenConflictIds = new Set<string>();
  const changes: VersionMergeChange[] = [];

  for (const resolution of resolutions) {
    if (seenConflictIds.has(resolution.conflictId)) {
      return {
        ok: false,
        diagnostics: [resolutionMismatchDiagnostic('duplicate conflict resolution supplied.')],
      };
    }
    seenConflictIds.add(resolution.conflictId);

    const conflict = conflictsById.get(resolution.conflictId);
    if (!conflict || resolution.expectedConflictDigest !== conflict.conflictDigest) {
      return {
        ok: false,
        diagnostics: [resolutionMismatchDiagnostic('resolution does not match the merge conflict.')],
      };
    }

    const option = conflict.resolutionOptions.find(
      (candidate) => candidate.optionId === resolution.optionId && candidate.kind === resolution.kind,
    );
    if (!option) {
      return {
        ok: false,
        diagnostics: [resolutionMismatchDiagnostic('resolution option does not match the conflict.')],
      };
    }

    changes.push({
      structural: conflict.structural,
      base: conflict.base,
      ours: conflict.ours,
      theirs: conflict.theirs,
      merged: option.value,
      ...(conflict.display ? { display: conflict.display } : {}),
      ...(option.diagnostics && option.diagnostics.length > 0
        ? { diagnostics: option.diagnostics }
        : {}),
    });
  }

  return { ok: true, changes };
}

function blockedApplyMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionApplyMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}

function invalidApplyMergeOptionDiagnostic(
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    recoverability: 'none',
    payload: { option },
  });
}

function resolutionMismatchDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_MERGE_RESOLUTION_MISMATCH', safeMessage, {
    recoverability: 'none',
  });
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.applyMerge.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: { operation: 'applyMerge', ...options.payload } } : {}),
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
