import { jest } from '@jest/globals';

import {
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  PROPOSAL_ID,
  acceptInput,
  createCompleteProposalService,
  createProposalRuntimeVersion,
} from './version-proposal-runtime-test-utils';

describe('WorkbookVersion proposal runtime capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps proposal capability disabled for incomplete attached services', async () => {
    const proposalService = {
      createProposal: jest.fn(),
    };
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:proposal']).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
      retryable: false,
    });
  });

  it('enables proposal capability for a complete attached proposal service', async () => {
    const version = createProposalRuntimeVersion({
      versioning: { proposalService: createCompleteProposalService() },
    });

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:proposal']).toEqual({ enabled: true });
  });

  it('keeps acceptProposal disabled by default without dynamic merge capabilities', async () => {
    const proposalService = createCompleteProposalService();
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.acceptProposal(acceptInput('accept-default-disabled') as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergePreview',
        dependency: 'VC-07',
      },
    });
    expect(proposalService.acceptProposal).not.toHaveBeenCalled();
  });

  it('does not treat generic ref administration as merge apply capability', async () => {
    const proposalService = createCompleteProposalService();
    const fastForwardRef = jest.fn();
    const version = createProposalRuntimeVersion({
      versioning: {
        proposalService,
        mergeService: { merge: jest.fn() },
        refAdmin: { fastForwardRef },
      },
    });

    const result = await version.acceptProposal(acceptInput('accept-no-ref-admin-leak') as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'VC-07',
      },
    });
    expect(proposalService.acceptProposal).not.toHaveBeenCalled();
    expect(fastForwardRef).not.toHaveBeenCalled();
  });

  it('dispatches acceptProposal only when proposal, merge preview, and merge apply are attached', async () => {
    const acceptResult = {
      status: 'stale',
      proposalId: PROPOSAL_ID,
      expectedTargetHeadId: BASE_COMMIT_ID,
      actualTargetHeadId: HEAD_COMMIT_ID,
    };
    const proposalService = createCompleteProposalService({
      acceptProposal: jest.fn(async () => acceptResult),
    });
    const version = createProposalRuntimeVersion({
      versioning: {
        proposalService,
        mergeService: { merge: jest.fn() },
        applyMergeService: { applyMerge: jest.fn() },
      },
    });
    const input = acceptInput('accept-dispatch');

    const result = await version.acceptProposal(input as any);

    expect(result).toEqual({ ok: true, value: acceptResult });
    expect(proposalService.acceptProposal).toHaveBeenCalledWith(input);
  });
});
