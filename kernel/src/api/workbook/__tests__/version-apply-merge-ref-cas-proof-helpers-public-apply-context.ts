import { jest } from '@jest/globals';

import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { applyMergeWorkbookVersion } from '../version-apply-merge';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
} from './version-apply-merge-ref-cas-proof-helpers-constants';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';

export async function publicApplyContext(input: {
  readonly targetCommitId?: WorkbookCommitId;
  readonly targetRevision?: VersionCommitExpectedHead['revision'];
  readonly symbolicTarget?: VersionMainRefName | VersionRefName;
  readonly symbolicRevision?: VersionCommitExpectedHead['revision'];
  readonly fastForwardMerge?: jest.Mock;
  readonly mergeCommit?: jest.Mock;
  readonly merge?: jest.Mock;
}): Promise<Parameters<typeof applyMergeWorkbookVersion>[0]> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'public-apply-target-ref-cas');
  const registry = await createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const targetCommitId = input.targetCommitId ?? EXPECTED_TARGET_HEAD.commitId;
  const targetRevision = input.targetRevision ?? EXPECTED_TARGET_HEAD.revision;
  const symbolicTarget = input.symbolicTarget ?? TARGET_REF;
  const symbolicRevision =
    input.symbolicRevision ?? EXPECTED_TARGET_HEAD.symbolicHeadRevision ?? targetRevision;
  const readRef = jest.fn(async (name: string) => {
    if (name === 'HEAD') {
      return {
        status: 'success' as const,
        ref: {
          name: 'HEAD' as const,
          target: symbolicTarget,
          revision: symbolicRevision,
        },
        diagnostics: [],
      };
    }
    if (name === TARGET_REF) {
      return {
        status: 'success' as const,
        ref: {
          name: TARGET_REF,
          commitId: targetCommitId,
          revision: targetRevision,
          updatedAt: CREATED_AT,
        },
        diagnostics: [],
      };
    }
    return {
      status: 'degraded' as const,
      ref: null,
      diagnostics: [
        {
          code: 'VERSION_DANGLING_REF',
          message: 'test ref not found',
          recoverability: 'retry',
        },
      ],
    };
  });
  const provider = {
    accessContext: {},
    readGraphRegistry: jest.fn(async () => ({
      status: 'ok' as const,
      registry,
      diagnostics: [],
    })),
    openGraph: jest.fn(async () => ({ namespace, readRef })),
  };
  return {
    versioning: {
      ...versionDomainSupportManifestRuntime(),
      provider,
      ...(input.merge ? { mergeService: { merge: input.merge } } : {}),
      writeService: {
        ...(input.fastForwardMerge ? { fastForwardMerge: input.fastForwardMerge } : {}),
        ...(input.mergeCommit ? { mergeCommit: input.mergeCommit } : {}),
      },
    },
  } as Parameters<typeof applyMergeWorkbookVersion>[0];
}
