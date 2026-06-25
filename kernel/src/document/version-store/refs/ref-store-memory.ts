import type { RefName } from './ref-name';
import { createMemoryBranch, initializeMemoryMain } from './ref-store-memory-branch';
import { deleteMemoryRef } from './ref-store-memory-delete';
import { getMemoryRef, listMemoryRefs } from './ref-store-memory-read';
import { createInMemoryRefStoreState, type InMemoryRefStoreState } from './ref-store-memory-state';
import { exportInMemoryRefStoreSnapshot } from './ref-store-memory-snapshot';
import { updateMemoryRef } from './ref-store-memory-update';
import type { InMemoryRefStoreSnapshot } from './ref-store-snapshot';
import type {
  CreateBranchInput,
  CreateBranchResult,
  DeleteRefInput,
  DeleteRefResult,
  GetRefOptions,
  GetRefResult,
  GetRefWithTombstoneOptions,
  GetRefWithTombstoneResult,
  InitializeMainInput,
  InMemoryRefStoreOptions,
  ListRefsInput,
  ListRefsResult,
  RefMutationResult,
  UpdateRefInput,
} from './ref-store-types';

export class InMemoryRefStore {
  private readonly state: InMemoryRefStoreState;

  constructor(options: InMemoryRefStoreOptions) {
    this.state = createInMemoryRefStoreState(options);
  }

  exportSnapshot(): InMemoryRefStoreSnapshot {
    return exportInMemoryRefStoreSnapshot(this.state);
  }

  initializeMain(input: InitializeMainInput): RefMutationResult {
    return initializeMemoryMain(this.state, input);
  }

  createBranch(input: CreateBranchInput): CreateBranchResult {
    return createMemoryBranch(this.state, input);
  }

  getRef(name: RefName | string): GetRefResult;
  getRef(name: RefName | string, options: GetRefOptions): GetRefResult;
  getRef(name: RefName | string, options: GetRefWithTombstoneOptions): GetRefWithTombstoneResult;
  getRef(
    name: RefName | string,
    options: GetRefOptions | GetRefWithTombstoneOptions = {},
  ): GetRefResult | GetRefWithTombstoneResult {
    return getMemoryRef(this.state, name, options);
  }

  listRefs(input: ListRefsInput = {}): ListRefsResult {
    return listMemoryRefs(this.state, input);
  }

  updateRef(input: UpdateRefInput): RefMutationResult {
    return updateMemoryRef(this.state, input, false);
  }

  advanceRefForGraphWrite(input: UpdateRefInput): RefMutationResult {
    return updateMemoryRef(this.state, input, true);
  }

  deleteRef(input: DeleteRefInput): DeleteRefResult {
    return deleteMemoryRef(this.state, input);
  }
}

export function createInMemoryRefStore(options: InMemoryRefStoreOptions): InMemoryRefStore {
  return new InMemoryRefStore(options);
}
