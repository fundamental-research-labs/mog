import type {
  VersionDiagnosticPublicPayload,
  VersionListCommitsOptions,
  VersionPageToken,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  VERSION_HEAD_REF,
  VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE,
  VERSION_LIST_COMMITS_MAX_PAGE_SIZE,
  VERSION_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES,
  VERSION_LIST_COMMITS_OPTION_KEYS,
  VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX,
  VERSION_LIST_COMMITS_PAGE_TOKEN_RE,
  VERSION_LIST_COMMITS_PUBLIC_CURSOR_PREFIX,
  VERSION_MAIN_REF,
  VERSION_OPERATION_PAGE_TOKEN_RE,
} from './version-list-commits-constants';
import { publicDiagnostic } from './version-list-commits-diagnostics';
import { formatPrimitiveForPayload, isRecord, toCommitId } from './version-list-commits-utils';
import { validatePublicVersionBranchRefName } from '../version-public-ref-selectors';

export function validateListCommitsOptions(
  options: VersionListCommitsOptions,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isRecord(options) || Array.isArray(options)) {
    return [
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits options must be an object when supplied.',
        { severity: 'error', recoverability: 'none', payload: { option: 'options' } },
      ),
    ];
  }

  for (const key of Object.keys(options)) {
    if (!VERSION_LIST_COMMITS_OPTION_KEYS.has(key)) {
      diagnostics.push(
        publicDiagnostic('VERSION_INVALID_OPTIONS', 'listCommits received an unsupported option.', {
          severity: 'error',
          recoverability: 'none',
          payload: { option: key },
        }),
      );
    }
  }

  diagnostics.push(...validatePageSize(options));
  diagnostics.push(...validatePageTokenScope(options));
  diagnostics.push(...validateRootSelector(options));
  diagnostics.push(...validateDiagnosticOptions(options));

  return diagnostics;
}

export function normalizedLimit(options: VersionListCommitsOptions): number {
  return isRecord(options) && Number.isInteger(options.pageSize)
    ? (options.pageSize as number)
    : VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE;
}

export function toPageToken(value: unknown): VersionPageToken | undefined {
  return classifyPageToken(value).kind === 'valid' ? (value as VersionPageToken) : undefined;
}

function validatePageSize(options: VersionListCommitsOptions): readonly VersionStoreDiagnostic[] {
  const pageSizeValue: unknown = options.pageSize ?? VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE;
  if (
    typeof pageSizeValue === 'number' &&
    Number.isInteger(pageSizeValue) &&
    pageSizeValue >= 1 &&
    pageSizeValue <= VERSION_LIST_COMMITS_MAX_PAGE_SIZE
  ) {
    return [];
  }

  return [
    publicDiagnostic(
      'VERSION_INVALID_OPTIONS',
      'listCommits pageSize must be an integer from 1 through 500.',
      {
        severity: 'error',
        recoverability: 'none',
        payload: {
          option: 'pageSize',
          min: 1,
          max: VERSION_LIST_COMMITS_MAX_PAGE_SIZE,
          receivedPageSize: formatPrimitiveForPayload(pageSizeValue),
        },
      },
    ),
  ];
}

function validatePageTokenScope(
  options: VersionListCommitsOptions,
): readonly VersionStoreDiagnostic[] {
  if (options.pageToken === undefined) return [];

  const diagnostics: VersionStoreDiagnostic[] = [];
  const pageToken = classifyPageToken(options.pageToken);
  if (pageToken.kind !== 'valid') {
    diagnostics.push(
      publicDiagnostic(
        pageToken.kind === 'stale' ? 'VERSION_STALE_PAGE_CURSOR' : 'VERSION_INVALID_OPTIONS',
        pageToken.safeMessage,
        {
          severity: 'error',
          recoverability: pageToken.kind === 'stale' ? 'retry' : 'none',
          payload: { option: 'pageToken', ...pageToken.payload },
        },
      ),
    );
  }

  if (options.ref !== undefined || options.from !== undefined) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_STALE_PAGE_CURSOR',
        'listCommits pageToken cannot be combined with a new root selector.',
        {
          severity: 'error',
          recoverability: 'retry',
          payload: {
            option: 'pageToken',
            category: 'refScopeMismatch',
            cursorRootMismatch: true,
          },
        },
      ),
    );
  }

  return diagnostics;
}

function validateRootSelector(
  options: VersionListCommitsOptions,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];

  if (options.ref !== undefined && options.from !== undefined) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits accepts either ref or from, not both.',
        { severity: 'error', recoverability: 'none', payload: { option: 'ref' } },
      ),
    );
  }

  if (options.ref !== undefined) diagnostics.push(...validateListCommitsRef(options.ref));

  if (options.from !== undefined && !toCommitId(options.from)) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_ID',
        'listCommits from must be commit:sha256:<64 lowercase hex>.',
        { severity: 'error', recoverability: 'none', payload: { option: 'from' } },
      ),
    );
  }

  return diagnostics;
}

function validateDiagnosticOptions(
  options: VersionListCommitsOptions,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];

  if (options.includeOrphans !== undefined && typeof options.includeOrphans !== 'boolean') {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits includeOrphans must be a boolean when supplied.',
        { severity: 'error', recoverability: 'none', payload: { option: 'includeOrphans' } },
      ),
    );
  } else if (options.includeOrphans === true) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_PERMISSION_DENIED',
        'Orphan commit listing requires diagnostics support that is not exposed by this slice.',
        {
          severity: 'error',
          recoverability: 'unsupported',
          payload: { option: 'includeOrphans' },
        },
      ),
    );
  }

  if (options.includeDiagnostics !== undefined && typeof options.includeDiagnostics !== 'boolean') {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits includeDiagnostics must be a boolean when supplied.',
        {
          severity: 'error',
          recoverability: 'none',
          payload: { option: 'includeDiagnostics' },
        },
      ),
    );
  }

  return diagnostics;
}

function validateListCommitsRef(ref: unknown): readonly VersionStoreDiagnostic[] {
  if (ref === VERSION_HEAD_REF) return [];
  if (ref === VERSION_MAIN_REF) return [];
  if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) {
    return [
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits ref must be HEAD or refs/heads/<public branch>.',
        {
          severity: 'error',
          recoverability: 'none',
          payload: { option: 'ref', refName: 'redacted' },
        },
      ),
    ];
  }

  const parsed = validatePublicVersionBranchRefName(ref.slice('refs/heads/'.length), 'ref');
  if (parsed.ok) return [];
  if (parsed.diagnostics.some((item) => item.issue === 'reservedPublicNamespace')) {
    return [
      publicDiagnostic(
        'VERSION_PERMISSION_DENIED',
        'listCommits ref is not exposed by this public slice.',
        {
          severity: 'error',
          recoverability: 'unsupported',
          payload: { option: 'ref', refName: 'redacted' },
        },
      ),
    ];
  }
  return parsed.diagnostics.map((item) =>
    publicDiagnostic('VERSION_INVALID_OPTIONS', 'listCommits ref must be public-safe.', {
      severity: 'error',
      recoverability: 'none',
      payload: { option: 'ref', refName: 'redacted', issue: item.issue },
    }),
  );
}

function classifyPageToken(value: unknown):
  | { readonly kind: 'valid' }
  | {
      readonly kind: 'invalid' | 'stale';
      readonly safeMessage: string;
      readonly payload: VersionDiagnosticPublicPayload;
    } {
  if (typeof value !== 'string') {
    return {
      kind: 'invalid',
      safeMessage: 'listCommits pageToken is malformed or unsupported.',
      payload: { category: 'malformedCursor' },
    };
  }

  if (value.length > VERSION_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES) {
    return {
      kind: 'invalid',
      safeMessage: 'listCommits pageToken exceeds the public cursor size limit.',
      payload: {
        category: 'oversizedCursor',
        max: VERSION_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES,
        receivedCursorBytes: value.length,
      },
    };
  }

  if (
    value.length > VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX.length &&
    value.startsWith(VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX) &&
    VERSION_LIST_COMMITS_PAGE_TOKEN_RE.test(
      value.slice(VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX.length),
    )
  ) {
    return { kind: 'valid' };
  }

  if (
    value.length > VERSION_LIST_COMMITS_PUBLIC_CURSOR_PREFIX.length &&
    value.startsWith(VERSION_LIST_COMMITS_PUBLIC_CURSOR_PREFIX) &&
    VERSION_LIST_COMMITS_PAGE_TOKEN_RE.test(
      value.slice(VERSION_LIST_COMMITS_PUBLIC_CURSOR_PREFIX.length),
    )
  ) {
    return { kind: 'valid' };
  }

  if (value.startsWith(VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX)) {
    return {
      kind: 'invalid',
      safeMessage: 'listCommits pageToken is malformed or unsupported.',
      payload: { category: 'forgedCursor' },
    };
  }

  if (value.startsWith('mog-vcommits-v')) {
    return {
      kind: 'stale',
      safeMessage: 'listCommits pageToken uses an unsupported public cursor order or version.',
      payload: { category: 'unsupportedCursorVersion' },
    };
  }

  if (VERSION_OPERATION_PAGE_TOKEN_RE.test(value)) {
    return {
      kind: 'stale',
      safeMessage: 'listCommits pageToken belongs to a different version read operation.',
      payload: { category: 'wrongOperationCursor' },
    };
  }

  return {
    kind: 'invalid',
    safeMessage: 'listCommits pageToken is malformed or unsupported.',
    payload: { category: 'malformedCursor' },
  };
}
