import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { validateApplyMergeTargetRefCasProof } from '../version/apply-merge/target-ref/version-apply-merge-target-ref';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';

const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: 'apply-merge-target-ref-cas' };
const CREATED_AT = '2026-06-23T00:00:00.000Z';

export const TARGET_REF = 'refs/heads/main' as VersionMainRefName;
export const OURS = commitId('1');
export const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: 'target-1' },
};

export async function ctxWithReadRef(
  readRef: (name: string) => Promise<unknown>,
): Promise<Parameters<typeof validateApplyMergeTargetRefCasProof>[0]> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'target-ref-cas');
  const registry = await createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: namespace.graphId,
    rootCommitId: OURS,
    createdAt: CREATED_AT,
  });
  return {
    versioning: {
      provider: {
        accessContext: {},
        readGraphRegistry: async () => ({ status: 'ok' as const, registry, diagnostics: [] }),
        openGraph: async () => ({ namespace, readRef }),
      },
    },
  } as Parameters<typeof validateApplyMergeTargetRefCasProof>[0];
}

export function targetRef(input: { revision?: VersionCommitExpectedHead['revision'] } = {}) {
  return {
    status: 'success' as const,
    ref: {
      name: TARGET_REF,
      commitId: OURS,
      ...('revision' in input
        ? { revision: input.revision }
        : { revision: EXPECTED_TARGET_HEAD.revision }),
      updatedAt: CREATED_AT,
    },
    diagnostics: [],
  };
}

export function symbolicHead() {
  return {
    status: 'success' as const,
    ref: {
      name: 'HEAD' as const,
      target: TARGET_REF,
      revision: { kind: 'counter' as const, value: 'head-1' },
    },
    diagnostics: [],
  };
}

function commitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64)}` as WorkbookCommitId;
}
