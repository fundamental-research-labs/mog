import { expect, jest } from '@jest/globals';

type BranchWriteService = {
  createBranch: (...args: any[]) => any;
  fastForwardBranch: (...args: any[]) => any;
  deleteBranch: (...args: any[]) => any;
};

export function spyOnBranchWrites(branchService: BranchWriteService) {
  return {
    createBranch: jest.spyOn(branchService, 'createBranch'),
    fastForwardBranch: jest.spyOn(branchService, 'fastForwardBranch'),
    deleteBranch: jest.spyOn(branchService, 'deleteBranch'),
  };
}

export function expectBranchWritesNotCalled(spies: ReturnType<typeof spyOnBranchWrites>): void {
  expect(spies.createBranch).not.toHaveBeenCalled();
  expect(spies.fastForwardBranch).not.toHaveBeenCalled();
  expect(spies.deleteBranch).not.toHaveBeenCalled();
}
