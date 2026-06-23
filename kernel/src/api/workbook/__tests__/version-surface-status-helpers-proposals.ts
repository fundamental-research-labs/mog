import { jest } from '@jest/globals';

export function createCompleteProposalService(overrides: Record<string, unknown> = {}) {
  return {
    createProposal: jest.fn(),
    startProposalWorkspace: jest.fn(),
    getProposalWorkspace: jest.fn(),
    disposeProposalWorkspace: jest.fn(),
    commitProposalWorkspace: jest.fn(),
    failProposal: jest.fn(),
    getProposal: jest.fn(),
    listProposals: jest.fn(),
    markProposalVerified: jest.fn(),
    openProposalReview: jest.fn(),
    acceptProposal: jest.fn(),
    rejectProposal: jest.fn(),
    supersedeProposal: jest.fn(),
    proposalWorkspaceLifecycleAvailable: true,
    ...overrides,
  };
}
