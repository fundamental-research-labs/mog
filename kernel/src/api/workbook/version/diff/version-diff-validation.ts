import type {
  VersionCommitish,
  VersionDiffOptions,
  VersionPageToken,
  VersionRefName,
  VersionRefSelector,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';
import {
  VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  VERSION_DIFF_MAX_PAGE_LIMIT,
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
} from '@mog-sdk/contracts/versioning';
import {
  VERSION_COMMIT_SELECTOR_KEYS,
  VERSION_DIFF_OPTION_KEYS,
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  VERSION_REF_SELECTOR_KEYS,
} from './version-diff-constants';
import { invalidDiffOptionDiagnostic, unsupportedRefDiagnostic } from './version-diff-diagnostics';
import type {
  DiffValidationResult,
  NormalizedDiffCommitish,
  NormalizedDiffOptions,
} from './version-diff-types';
import { formatPrimitiveForPayload, isRecord, toCommitId, toPageToken } from './version-diff-utils';
import { validatePublicVersionBranchRefName } from '../version-public-ref-selectors';

export function validateDiffRequest(
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOptions,
): DiffValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedBase = normalizeCommitish(base, 'base', diagnostics);
  const normalizedTarget = normalizeCommitish(target, 'target', diagnostics);
  const normalizedOptions = normalizeDiffOptions(options, diagnostics);
  if (!normalizedBase || !normalizedTarget || !normalizedOptions || diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    base: normalizedBase,
    target: normalizedTarget,
    options: normalizedOptions,
  };
}

function normalizeCommitish(
  value: unknown,
  selector: 'base' | 'target',
  diagnostics: VersionStoreDiagnostic[],
): NormalizedDiffCommitish | undefined {
  const directCommitId = toCommitId(value);
  if (directCommitId) return { kind: 'commit', id: directCommitId };
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidDiffOptionDiagnostic(
        selector,
        `${selector} must be a commit id or a public version commitish selector.`,
      ),
    );
    return undefined;
  }
  if (value.kind === 'commit') {
    rejectUnknownNestedKeys(value, VERSION_COMMIT_SELECTOR_KEYS, selector, diagnostics);
    const id = toCommitId(value.id);
    if (!id) {
      diagnostics.push(
        invalidDiffOptionDiagnostic(`${selector}.id`, `${selector} commit id is invalid.`),
      );
      return undefined;
    }
    return { kind: 'commit', id };
  }
  if (value.kind === 'ref') {
    rejectUnknownNestedKeys(value, VERSION_REF_SELECTOR_KEYS, selector, diagnostics);
    const name = normalizePublicRefSelector(value.name);
    if (!name) {
      diagnostics.push(unsupportedRefDiagnostic(selector));
      return undefined;
    }
    return { kind: 'ref', name };
  }
  diagnostics.push(
    invalidDiffOptionDiagnostic(
      `${selector}.kind`,
      `${selector} selector kind must be "commit" or "ref".`,
    ),
  );
  return undefined;
}

function normalizeDiffOptions(
  input: VersionDiffOptions,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedDiffOptions | undefined {
  if (input === undefined) return {};
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidDiffOptionDiagnostic('options', 'diff options must be an object when supplied.'),
    );
    return undefined;
  }
  const options: {
    pageSize?: number;
    pageToken?: VersionPageToken;
    includeDerivedImpact?: boolean;
    includeDiagnostics?: boolean;
  } = {};
  for (const key of Object.keys(input)) {
    if (VERSION_DIFF_OPTION_KEYS.has(key)) continue;
    diagnostics.push(invalidDiffOptionDiagnostic(key, `Unknown diff option "${key}".`));
  }

  const pageSizeValue = (input as VersionDiffOptions).pageSize;
  const pageSize = pageSizeValue ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT;
  if (
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > VERSION_DIFF_MAX_PAGE_LIMIT
  ) {
    diagnostics.push(
      invalidDiffOptionDiagnostic(
        'pageSize',
        'diff pageSize must be an integer from 1 through 500.',
        {
          min: 1,
          max: VERSION_DIFF_MAX_PAGE_LIMIT,
          receivedPageSize: formatPrimitiveForPayload(pageSize),
        },
      ),
    );
  } else if (pageSizeValue !== undefined) {
    options.pageSize = pageSize;
  }

  const pageTokenValue = (input as VersionDiffOptions).pageToken;
  if (pageTokenValue !== undefined) {
    if (
      typeof pageTokenValue === 'string' &&
      pageTokenValue.length > VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH
    ) {
      diagnostics.push(
        invalidDiffOptionDiagnostic(
          'pageToken',
          'diff pageToken exceeds the public cursor size limit.',
          {
            max: VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
            receivedCursorBytes: pageTokenValue.length,
          },
        ),
      );
    } else {
      const pageToken = toPageToken(pageTokenValue);
      if (!pageToken) {
        diagnostics.push(
          invalidDiffOptionDiagnostic('pageToken', 'diff pageToken is malformed or unsupported.'),
        );
      } else {
        options.pageToken = pageToken;
      }
    }
  }

  const includeDerivedImpact = (input as VersionDiffOptions).includeDerivedImpact;
  if (includeDerivedImpact !== undefined) {
    if (typeof includeDerivedImpact !== 'boolean') {
      diagnostics.push(
        invalidDiffOptionDiagnostic(
          'includeDerivedImpact',
          'includeDerivedImpact must be a boolean.',
        ),
      );
    } else {
      options.includeDerivedImpact = includeDerivedImpact;
    }
  }

  const includeDiagnostics = (input as VersionDiffOptions).includeDiagnostics;
  if (includeDiagnostics !== undefined) {
    if (typeof includeDiagnostics !== 'boolean') {
      diagnostics.push(
        invalidDiffOptionDiagnostic('includeDiagnostics', 'includeDiagnostics must be a boolean.'),
      );
    } else {
      options.includeDiagnostics = includeDiagnostics;
    }
  }
  return options;
}

function rejectUnknownNestedKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(
      invalidDiffOptionDiagnostic(
        `${option}.${key}`,
        `Unknown ${option} selector option "${key}".`,
      ),
    );
  }
}

function normalizePublicRefSelector(value: unknown): VersionRefSelector | null {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith('refs/heads/')) {
    const parsed = validatePublicVersionBranchRefName(value.slice('refs/heads/'.length));
    if (parsed.ok) return value as VersionRefName;
  }
  return null;
}
