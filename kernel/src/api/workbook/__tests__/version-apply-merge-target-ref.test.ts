import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { validateApplyMergeTargetRefCasProof } from '../version-apply-merge-target-ref';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';

const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: 'apply-merge-target-ref-cas' };
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const TARGET_REF = 'refs/heads/main' as VersionMainRefName;
const OURS = commitId('1');
const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: 'target-1' },
};

describe('validateApplyMergeTargetRefCasProof target ref resolution', () => {
  it('blocks when symbolic HEAD resolves away from the public target ref without leaking private refs', async () => {
    const privateRef = 'refs/heads/review/private-plan' as VersionRefName;
    const result = await validateApplyMergeTargetRefCasProof(
      await ctxWithReadRef(async (name): Promise<unknown> => {
        if (name === TARGET_REF) return targetRef();
        return {
          status: 'success' as const,
          ref: {
            name: 'HEAD' as const,
            target: privateRef,
            revision: { kind: 'counter' as const, value: 'head-1' },
          },
          diagnostics: [],
        };
      }),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'blocked',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'symbolicTargetMismatch',
            expectedTargetRef: TARGET_REF,
            actualTargetRef: 'redacted',
          }),
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain(privateRef);
  });

  it('blocks target refs that do not expose a ref revision proof', async () => {
    const result = await validateApplyMergeTargetRefCasProof(
      await ctxWithReadRef(async (name): Promise<unknown> => {
        if (name === TARGET_REF) {
          return targetRef({ revision: undefined });
        }
        return symbolicHead();
      }),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'blocked',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PROVIDER_FAILED',
          safeMessage: 'The target ref revision is unavailable for applyMerge CAS validation.',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'missingTargetRefRevision',
            targetRef: TARGET_REF,
          }),
        }),
      ],
    });
  });

  it('redacts unsafe provider ref names from mapped diagnostics', async () => {
    const secretRef = 'refs/heads/review/secret-draft';
    const result = await validateApplyMergeTargetRefCasProof(
      await ctxWithReadRef(
        async (): Promise<unknown> => ({
          status: 'degraded' as const,
          ref: null,
          diagnostics: [
            {
              code: 'VERSION_DANGLING_REF',
              message: `could not read ${secretRef}`,
              safeMessage: `could not read ${secretRef}`,
              recoverability: 'repair',
              refName: secretRef,
            },
          ],
        }),
      ),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'blocked',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_DANGLING_REF',
          safeMessage: 'Version applyMerge target-ref CAS validation failed.',
          recoverability: 'repair',
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain(secretRef);
  });
});

async function ctxWithReadRef(
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

function targetRef(input: { revision?: VersionCommitExpectedHead['revision'] } = {}) {
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

function symbolicHead() {
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
