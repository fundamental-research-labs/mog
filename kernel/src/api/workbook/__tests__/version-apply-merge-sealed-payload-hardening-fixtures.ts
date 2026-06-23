import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionSealedResolutionPayloadRef,
  Workbook,
} from '@mog-sdk/contracts/api';

import type { VersionDocumentScope } from '../../../document/version-store/provider';
import {
  expectSealedApplyRejected,
  putForgedResolutionPayload,
  putResolutionPayload,
  requireResolutionOption,
  resolutionFor,
  withPersistedConflictPreview,
} from './version-apply-merge-sealed-payload-test-utils';
import type {
  PersistedConflictPreview,
  SealedPayloadVersionStoreProvider,
} from './version-apply-merge-sealed-payload-test-utils';

type ForgedResolutionPayloadInput = Parameters<typeof putForgedResolutionPayload>[0];

interface SealedPayloadHardeningRejectionInput {
  readonly resolution: VersionApplyMergeResolution | readonly VersionApplyMergeResolution[];
  readonly messages: readonly string[];
  readonly leakCanaries: readonly string[];
  readonly expectPayloadOperation?: boolean;
}

export interface SealedPayloadHardeningFixture {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly firstConflict: VersionMergeConflict;
  readonly secondConflict: VersionMergeConflict;
  readonly firstOption: VersionMergeConflict['resolutionOptions'][number];
  readonly firstResolution: VersionApplyMergeResolution;
  readonly secondResolution: VersionApplyMergeResolution;
  readonly forgedPayloadInput: ForgedResolutionPayloadInput;
  readonly putValidFirstPayload: () => Promise<VersionSealedResolutionPayloadRef>;
  readonly reject: (input: SealedPayloadHardeningRejectionInput) => Promise<void>;
}

export async function withSealedPayloadHardeningFixture(
  graphId: string,
  run: (fixture: SealedPayloadHardeningFixture) => Promise<void>,
): Promise<void> {
  let mergeCommitCallCount = 0;
  await withPersistedConflictPreview(
    graphId,
    async ({ provider, documentScope, sourceWb, preview, expectedTargetHead }) => {
      expect(preview.conflicts.length).toBeGreaterThan(1);
      const firstConflict = preview.conflicts[0];
      const secondConflict = preview.conflicts[1];
      const firstOption = requireResolutionOption(firstConflict, 'acceptTheirs');
      const firstResolution = resolutionFor(firstConflict, 'acceptTheirs');
      const secondResolution = resolutionFor(secondConflict, 'acceptTheirs');
      const forgedPayloadInput = {
        provider,
        graphId,
        documentScope,
        preview,
        conflict: firstConflict,
        option: firstOption,
        expectedTargetHead,
        redactionPolicyDigest: preview.resultDigest,
        value: firstOption.value as any,
      };

      await run({
        provider,
        graphId,
        documentScope,
        sourceWb,
        preview,
        expectedTargetHead,
        firstConflict,
        secondConflict,
        firstOption,
        firstResolution,
        secondResolution,
        forgedPayloadInput,
        putValidFirstPayload: () =>
          putResolutionPayload({
            sourceWb,
            preview,
            conflict: firstConflict,
            option: firstOption,
            expectedTargetHead,
            redactionPolicyDigest: preview.resultDigest,
            value: firstOption.value as any,
            purpose: 'chooseValue',
          }),
        reject: ({ resolution, messages, leakCanaries, expectPayloadOperation }) =>
          expectSealedApplyRejected({
            provider,
            graphId,
            documentScope,
            sourceWb,
            preview,
            expectedTargetHead,
            resolution,
            messages,
            leakCanaries,
            expectPayloadOperation,
          }),
      });
    },
    {
      applyMergeService: {
        mergeCommit: async () => {
          mergeCommitCallCount += 1;
        },
      },
    },
    ['A1', 'B1'],
  );
  expect(mergeCommitCallCount).toBe(0);
}
