import type {
  RedactionPolicy,
  VersionCommitOptions,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { validateRefName } from '../../../../document/version-store/refs/ref-name';
import {
  VERSION_BRANCH_REF_PREFIX,
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
} from './version-commit-constants';
import { publicDiagnostic } from './version-commit-diagnostics';
import {
  REDACTION_POLICY_KEYS,
  REDACTION_POLICY_MODES,
  VERSION_COMMIT_EXPECTED_HEAD_KEYS,
} from './version-commit-options-constants';
import { invalidCommitOptionDiagnostic } from './version-commit-options-diagnostics';
import { isRecord, toCommitId, toPublicRevision } from './version-commit-utils';

export function validateTargetRef(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidCommitOptionDiagnostic('targetRef', 'targetRef must be a string.'));
    return undefined;
  }
  if (value === VERSION_HEAD_REF) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('targetRef', 'targetRef must be a concrete refs/heads/* ref.'),
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
            severity: 'error',
            recoverability: 'none',
            payload: { option: 'targetRef', issue: item.issue, refName: 'redacted' },
            mutationGuarantee: 'no-write-attempted',
          },
        ),
      ),
    );
    return undefined;
  }

  return parsed.name === 'main'
    ? VERSION_MAIN_REF
    : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
}

export function validateExpectedHead(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionCommitOptions['expectedHead'] | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead', 'expectedHead must be an object.'),
    );
    return undefined;
  }

  rejectUnknownNestedKeys(value, VERSION_COMMIT_EXPECTED_HEAD_KEYS, 'expectedHead', diagnostics);
  const commitId = toCommitId(value.commitId);
  const revision = toPublicRevision(value.revision);
  const symbolicHeadRevision =
    value.symbolicHeadRevision === undefined
      ? undefined
      : toPublicRevision(value.symbolicHeadRevision);

  if (!commitId) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead.commitId', 'expectedHead.commitId is invalid.'),
    );
  }
  if (!revision) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead.revision', 'expectedHead.revision is invalid.'),
    );
  }
  if ('symbolicHeadRevision' in value && !symbolicHeadRevision) {
    diagnostics.push(
      invalidCommitOptionDiagnostic(
        'expectedHead.symbolicHeadRevision',
        'expectedHead.symbolicHeadRevision is invalid.',
      ),
    );
  }
  if (!commitId || !revision || ('symbolicHeadRevision' in value && !symbolicHeadRevision)) {
    return undefined;
  }

  return {
    commitId,
    revision,
    ...(symbolicHeadRevision ? { symbolicHeadRevision } : {}),
  };
}

export function validateRedactionPolicy(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): RedactionPolicy | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('redactionPolicy', 'redactionPolicy must be an object.'),
    );
    return undefined;
  }

  rejectUnknownNestedKeys(value, REDACTION_POLICY_KEYS, 'redactionPolicy', diagnostics);
  if (!REDACTION_POLICY_MODES.has(String(value.mode))) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('redactionPolicy.mode', 'redactionPolicy.mode is unsupported.'),
    );
  }

  for (const key of ['redactSecrets', 'redactExternalLinks', 'redactAgentTrace'] as const) {
    if (typeof value[key] !== 'boolean') {
      diagnostics.push(
        invalidCommitOptionDiagnostic(`redactionPolicy.${key}`, `${key} must be a boolean.`),
      );
    }
  }

  if (
    !REDACTION_POLICY_MODES.has(String(value.mode)) ||
    typeof value.redactSecrets !== 'boolean' ||
    typeof value.redactExternalLinks !== 'boolean' ||
    typeof value.redactAgentTrace !== 'boolean'
  ) {
    return undefined;
  }

  return {
    mode: value.mode as RedactionPolicy['mode'],
    redactSecrets: value.redactSecrets,
    redactExternalLinks: value.redactExternalLinks,
    redactAgentTrace: value.redactAgentTrace,
  };
}

export function rejectUnknownNestedKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(
      invalidCommitOptionDiagnostic(`${option}.${key}`, `Unknown ${option} option "${key}".`),
    );
  }
}

export function validateCommitMessage(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): string | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidCommitOptionDiagnostic('message', 'commit message must be a string.'));
    return undefined;
  }
  const message = value.normalize('NFC').replace(/[ \t\n]+$/u, '');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(message)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic(
        'message',
        'commit message contains unsupported control characters.',
      ),
    );
    return undefined;
  }
  if ([...message].length > 4096) {
    diagnostics.push(invalidCommitOptionDiagnostic('message', 'commit message is too long.'));
    return undefined;
  }
  return message;
}
