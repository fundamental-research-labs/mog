import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import { CREATED_AT, VERSION_AUTHOR } from './version-commit-dirty-tracking-helpers-constants';

export function commitSummary(label: string) {
  return {
    id: commitId(label),
    parents: [commitId('root')],
    createdAt: CREATED_AT,
    author: VERSION_AUTHOR,
  };
}

export function commitRef(label: string, revision: string) {
  return {
    id: commitId(label),
    refName: 'refs/heads/main',
    resolvedFrom: 'HEAD',
    refRevision: { kind: 'counter', value: revision },
  };
}

export function commitId(label: string) {
  const byte = label === 'child' ? 'b' : label === 'moved' ? 'c' : 'a';
  return `commit:sha256:${byte.repeat(64)}`;
}

export function operationContext(
  overrides: Partial<VersionOperationContext> = {},
): VersionOperationContext {
  return {
    operationId: 'operation-1',
    kind: 'mutation',
    author: VERSION_AUTHOR,
    createdAt: CREATED_AT,
    domainIds: ['test'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...overrides,
  };
}
