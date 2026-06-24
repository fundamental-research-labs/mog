import type { VersionCommitOptions } from '@mog-sdk/contracts/api';

import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphBranchRefName,
} from './graph';
import {
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import { REF_NAME_STORAGE_PREFIX, validateRefName } from './refs/ref-name';

type NormalizedCommitTargetRefResult =
  | {
      readonly ok: true;
      readonly refName: VersionGraphBranchRefName;
      readonly options: VersionCommitOptions;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

type NormalizedCommitOptionsResult =
  | {
      readonly ok: true;
      readonly options: VersionCommitOptions;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export function normalizeCommitOptions(
  value: unknown,
  provider: VersionStoreProvider,
): NormalizedCommitOptionsResult {
  if (!isRecord(value) || Array.isArray(value)) {
    return {
      ok: false,
      diagnostics: [
        invalidCommitOptionsDiagnostic(
          provider,
          'Version commit options must be an object when supplied.',
          { option: 'options', issue: 'notObject' },
        ),
      ],
    };
  }

  const mode = value.mode;
  if (mode === undefined) {
    return { ok: true, options: value as VersionCommitOptions };
  }
  if (!isRecord(mode) || Array.isArray(mode)) {
    return {
      ok: false,
      diagnostics: [
        invalidCommitOptionsDiagnostic(provider, 'Version commit mode must be an object.', {
          option: 'mode',
          issue: 'notObject',
        }),
      ],
    };
  }

  const kind = mode.kind;
  if (kind === 'normal') {
    return { ok: true, options: value as VersionCommitOptions };
  }

  if (kind === 'root' || kind === 'import-root') {
    return {
      ok: false,
      diagnostics: [
        invalidCommitOptionsDiagnostic(
          provider,
          'Root and import-root commit modes are not exposed by this provider-backed commit service.',
          { option: 'mode.kind', issue: kind },
        ),
      ],
    };
  }

  return {
    ok: false,
    diagnostics: [
      invalidCommitOptionsDiagnostic(
        provider,
        'Provider-backed commit service supports only normal commits.',
        { option: 'mode.kind', issue: 'unsupportedMode' },
      ),
    ],
  };
}

export function normalizeCommitTargetRef(
  options: VersionCommitOptions,
  provider: VersionStoreProvider,
): NormalizedCommitTargetRefResult {
  const value = options.targetRef;
  if (value === undefined) {
    return { ok: true, refName: VERSION_GRAPH_MAIN_REF, options };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      diagnostics: [
        invalidTargetRefDiagnostic(provider, 'targetRef must be a string.', {
          option: 'targetRef',
          issue: 'notString',
        }),
      ],
    };
  }
  if (value === VERSION_GRAPH_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        invalidTargetRefDiagnostic(
          provider,
          'Version commit targetRef must be a concrete refs/heads/* ref.',
          { option: 'targetRef', issue: 'reservedSymbolicHead' },
        ),
      ],
    };
  }

  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((diagnostic) =>
        invalidTargetRefDiagnostic(
          provider,
          'Version commit targetRef must name a public-safe version branch.',
          { option: 'targetRef', issue: diagnostic.issue, refName: 'redacted' },
        ),
      ),
    };
  }

  const refName = `${REF_NAME_STORAGE_PREFIX}${parsed.name}` as VersionGraphBranchRefName;
  return {
    ok: true,
    refName,
    options: value === refName ? options : { ...options, targetRef: refName },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidCommitOptionsDiagnostic(
  provider: VersionStoreProvider,
  safeMessage: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): VersionStoreDiagnostic {
  return versionStoreDiagnostic('VERSION_INVALID_OPTIONS', {
    operation: 'commitGraphWrite',
    documentScope: provider.documentScope,
    safeMessage,
    recoverability: 'none',
    mutationGuarantee: 'no-write-attempted',
    details,
  });
}

function invalidTargetRefDiagnostic(
  provider: VersionStoreProvider,
  safeMessage: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): VersionStoreDiagnostic {
  return invalidCommitOptionsDiagnostic(provider, safeMessage, details);
}
