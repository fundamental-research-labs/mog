import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  Workbook,
} from '@mog-sdk/contracts/api';

import {
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergeResolutionSetArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import {
  compactStrings,
  internalSha256Digest,
} from './version-apply-merge-sealed-payload-helpers-digests';
import type {
  PersistedConflictPreview,
  SealedPayloadVersionStoreProvider,
} from './version-apply-merge-sealed-payload-helpers-types';

export async function expectSealedApplyRejected(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly resolution: VersionApplyMergeResolution | readonly VersionApplyMergeResolution[];
  readonly messages: readonly string[];
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly leakCanaries?: readonly string[];
  readonly expectPayloadOperation?: boolean;
}): Promise<void> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const targetRef = input.targetRef ?? ('refs/heads/main' as VersionMainRefName);
  const resolutions = Array.isArray(input.resolution) ? input.resolution : [input.resolution];
  const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(
    namespace,
    resolutions,
  );
  const expectedResolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
    resultDigest: internalSha256Digest(input.preview.resultDigest),
    resolutionSetDigest: expectedResolutionSet.digest,
    targetRef,
    expectedTargetHead: input.expectedTargetHead,
  });

  const result = await input.sourceWb.version.applyMerge(
    {
      resultId: input.preview.resultId,
      resultDigest: input.preview.resultDigest,
      previewArtifactDigest: input.preview.previewArtifactDigest,
      resolutions,
    },
    { targetRef, expectedTargetHead: input.expectedTargetHead },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.applyMerge',
    },
  });
  if (result.ok) throw new Error('expected sealed apply to be rejected');
  expectStableResolutionMismatchDiagnostics({
    diagnostics: result.error.diagnostics,
    operation: 'applyMerge',
    messages: input.messages,
    expectPayloadOperation: input.expectPayloadOperation,
    leakCanaries: diagnosticLeakCanaries({
      preview: input.preview,
      resolutions,
      targetRef,
      expectedTargetHead: input.expectedTargetHead,
      extra: input.leakCanaries ?? [],
    }),
  });

  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  await expect(
    graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
  ).resolves.toBe(false);
  await expect(
    graph.hasObject(resolvedMergeAttemptArtifactRef(expectedResolvedAttempt.digest)),
  ).resolves.toBe(false);
}

export function expectStableResolutionMismatchDiagnostics(input: {
  readonly diagnostics: readonly unknown[];
  readonly operation: 'applyMerge' | 'saveMergeResolutions';
  readonly messages: readonly string[];
  readonly leakCanaries?: readonly string[];
  readonly expectPayloadOperation?: boolean;
}): void {
  expect(input.diagnostics).toStrictEqual(
    input.messages.map((message) => ({
      code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
      severity: 'error',
      message,
      owner: 'version-store',
      data: {
        ...(input.expectPayloadOperation === false ? {} : { operation: input.operation }),
        recoverability: 'none',
        messageTemplateId: `version.${input.operation}.VERSION_MERGE_RESOLUTION_MISMATCH`,
        redacted: true,
        ...(input.expectPayloadOperation === false
          ? {}
          : { payload: { operation: input.operation } }),
        mutationGuarantee: 'no-write-attempted',
      },
    })),
  );
  expectNoDiagnosticLeaks(input.diagnostics, input.leakCanaries ?? []);
}

function diagnosticLeakCanaries(input: {
  readonly preview: PersistedConflictPreview;
  readonly resolutions: readonly VersionApplyMergeResolution[];
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly extra: readonly string[];
}): readonly string[] {
  return compactStrings([
    input.preview.resultId,
    input.preview.resultDigest.digest,
    ...input.resolutions.flatMap((resolution) => [
      resolution.conflictId,
      resolution.expectedConflictDigest,
      resolution.optionId,
      resolution.sealedPayloadRef?.payloadId,
      resolution.sealedPayloadRef?.payloadDigest.digest,
    ]),
    input.targetRef,
    input.expectedTargetHead.commitId,
    input.expectedTargetHead.revision.value,
    ...input.extra,
  ]);
}

function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}
