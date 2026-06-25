import type {
  VersionBranchName,
  VersionMainRefName,
  VersionRef,
  VersionRefName,
} from '@mog-sdk/contracts/api';

export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const VERSION_BRANCH_NAMESPACES = Object.freeze(['scenario', 'agent', 'import', 'review'] as const);
const VERSION_BRANCH_NAME_PATTERN =
  /^(?:main|(?:scenario|agent|import|review)\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*)$/;
const VERSION_BRANCH_MAX_BYTES = 128;
const RESERVED_REF_PREFIXES = Object.freeze(['refs/system', 'refs/imports', 'refs/hidden']);

export type NormalizedVersionBranchName = {
  readonly branchName: VersionBranchName | 'main';
  readonly displayName: string;
  readonly refName: VersionMainRefName | VersionRefName;
};

export type VersionBranchNameValidationResult =
  | { readonly ok: true; readonly branch: NormalizedVersionBranchName }
  | { readonly ok: false; readonly reason: string };

export function displayBranchName(name: string): string {
  return name.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? name.slice(VERSION_BRANCH_REF_PREFIX.length)
    : name;
}

export function normalizeVersionBranchNameInput(value: string): VersionBranchNameValidationResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) return invalidBranchName('Enter a branch name.');

  if (trimmed === 'HEAD') {
    return invalidBranchName('HEAD is symbolic and cannot be created as a branch.');
  }

  if (isReservedRefName(trimmed)) {
    return invalidBranchName('Reserved refs cannot be created from the version panel.');
  }

  if (trimmed.startsWith('refs/') && !trimmed.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return invalidBranchName('Branch refs must use refs/heads/<branch>.');
  }

  const branchName = displayBranchName(trimmed);
  if (branchName.length === 0) {
    return invalidBranchName('refs/heads/* branch refs must include a branch name.');
  }

  const reason = invalidPublicBranchNameReason(branchName);
  if (reason) return invalidBranchName(reason);

  return {
    ok: true,
    branch: {
      branchName: branchName as VersionBranchName | 'main',
      displayName: branchName,
      refName:
        branchName === 'main'
          ? VERSION_MAIN_REF
          : (`${VERSION_BRANCH_REF_PREFIX}${branchName}` as VersionRefName),
    },
  };
}

export function validateVersionBranchCreationName(
  value: string,
  existingRefs: readonly Pick<VersionRef, 'name'>[],
): VersionBranchNameValidationResult {
  const normalized = normalizeVersionBranchNameInput(value);
  if (!normalized.ok) return normalized;

  if (normalized.branch.branchName === 'main') {
    return invalidBranchName('main is protected and cannot be created from the version panel.');
  }

  if (existingRefNames(existingRefs).has(normalized.branch.refName)) {
    return invalidBranchName(`Branch ${normalized.branch.displayName} already exists.`);
  }

  return normalized;
}

function invalidPublicBranchNameReason(branchName: string): string | undefined {
  if (utf8ByteLength(branchName) > VERSION_BRANCH_MAX_BYTES) {
    return `Branch names must be at most ${VERSION_BRANCH_MAX_BYTES} UTF-8 bytes.`;
  }

  if (branchName === 'detached') return '"detached" is reserved and cannot be created as a branch.';

  if (isReservedRefName(branchName)) {
    return 'Reserved refs cannot be created from the version panel.';
  }

  for (let index = 0; index < branchName.length; index += 1) {
    const char = branchName[index];
    const code = branchName.charCodeAt(index);
    if (code > 0x7f) return 'Branch names must contain ASCII only.';
    if (char === '%') return 'Branch names must not contain %.';
    if (code <= 0x1f || code === 0x7f) {
      return 'Branch names must not contain control characters.';
    }
    if (/\s/.test(char)) return 'Branch names must not contain whitespace.';
    if (char >= 'A' && char <= 'Z') return 'Branch names must use lowercase ASCII.';
  }

  if (branchName.startsWith('/')) return 'Branch names must not start with /.';
  if (branchName.endsWith('/')) return 'Branch names must not end with /.';
  if (branchName.includes('//')) return 'Branch names must not contain empty path segments.';
  if (branchName.includes('..')) return 'Branch names must not contain ...';

  const segments = branchName.split('/');
  if (segments.some((segment) => segment === '.lock')) {
    return 'Branch names must not contain a .lock segment.';
  }
  if (segments.some((segment) => segment.length > 0 && segment.endsWith('.lock'))) {
    return 'Branch name segments must not end with .lock.';
  }

  if (branchName !== 'main' && !startsWithPublicNamespace(branchName)) {
    return 'Branch names must start with scenario/, agent/, import/, or review/.';
  }

  if (!VERSION_BRANCH_NAME_PATTERN.test(branchName)) {
    return 'Branch names may contain lowercase letters, numbers, dots, underscores, hyphens, and slashes.';
  }

  return undefined;
}

function existingRefNames(refs: readonly Pick<VersionRef, 'name'>[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const ref of refs) {
    names.add(ref.name);
    const normalized = normalizeVersionBranchNameInput(ref.name);
    if (normalized.ok) names.add(normalized.branch.refName);
  }
  return names;
}

function startsWithPublicNamespace(branchName: string): boolean {
  return VERSION_BRANCH_NAMESPACES.some((namespace) => branchName.startsWith(`${namespace}/`));
}

function isReservedRefName(branchName: string): boolean {
  return RESERVED_REF_PREFIXES.some(
    (prefix) => branchName === prefix || branchName.startsWith(`${prefix}/`),
  );
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

function invalidBranchName(reason: string): VersionBranchNameValidationResult {
  return { ok: false, reason };
}
