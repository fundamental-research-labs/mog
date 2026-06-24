import {
  type BranchFailureResult,
  type BranchServiceErrorCode,
  type CreateBranchInput,
  type CreateBranchResult,
  type DeleteBranchInput,
  type DeleteBranchResult,
  type FastForwardBranchInput,
  type FastForwardBranchResult,
  type GetBranchHeadResult,
  type ListBranchesInput,
  type ListBranchesResult,
  type ReadBranchInput,
  type ReadBranchResult,
} from './branch-service';
import type { VersionGraphStore, VersionStoreProvider } from './provider';
import type { VersionDiagnostic } from './refs/ref-store';
import { namespaceForRegistry } from './registry';

type BranchProviderOperation =
  | 'createBranch'
  | 'readBranch'
  | 'listBranches'
  | 'fastForwardBranch'
  | 'deleteBranch'
  | 'getHead';

type OpenBranchServiceResult =
  | {
      readonly ok: true;
      readonly service: VersionGraphStore;
    }
  | {
      readonly ok: false;
      readonly result: BranchFailureResult;
    };

type DeleteCapableBranchGraphStore = {
  readonly deleteBranch: (input: DeleteBranchInput) => Promise<DeleteBranchResult>;
};

export interface ProviderBackedBranchLifecycleServiceOptions {
  readonly provider: VersionStoreProvider;
}

export class ProviderBackedBranchLifecycleService {
  private readonly provider: VersionStoreProvider;

  constructor(options: ProviderBackedBranchLifecycleServiceOptions) {
    this.provider = options.provider;
  }

  async createBranch(input: CreateBranchInput): Promise<CreateBranchResult> {
    const opened = await this.openVisibleBranchService('createBranch', true);
    if (!opened.ok) return opened.result;
    return opened.service.createBranch(input);
  }

  async readBranch(input: ReadBranchInput | string): Promise<ReadBranchResult> {
    const opened = await this.openVisibleBranchService('readBranch', false);
    if (!opened.ok) return opened.result;
    return opened.service.readBranch(input);
  }

  async listBranches(input: ListBranchesInput = {}): Promise<ListBranchesResult> {
    const opened = await this.openVisibleBranchService('listBranches', false);
    if (!opened.ok) return opened.result;
    return opened.service.listBranches(input);
  }

  async fastForwardBranch(input: FastForwardBranchInput): Promise<FastForwardBranchResult> {
    const opened = await this.openVisibleBranchService('fastForwardBranch', true);
    if (!opened.ok) return opened.result;
    return opened.service.fastForwardBranch(input);
  }

  async deleteBranch(input: DeleteBranchInput): Promise<DeleteBranchResult> {
    const opened = await this.openVisibleBranchService('deleteBranch', true);
    if (!opened.ok) return opened.result;
    const service = toDeleteCapableBranchGraphStore(opened.service);
    if (!service) {
      return branchFailure(
        'versionCapabilityDisabled',
        'Version ref lifecycle delete is unavailable for this document.',
        'deleteBranch',
      ).result;
    }
    return service.deleteBranch(input);
  }

  async getHead(): Promise<GetBranchHeadResult> {
    const opened = await this.openVisibleBranchService('getHead', false);
    if (!opened.ok) return opened.result;
    return opened.service.getHead();
  }

  private async openVisibleBranchService(
    operation: BranchProviderOperation,
    requiresWrite: boolean,
  ): Promise<OpenBranchServiceResult> {
    if (!this.provider.capabilities.reads.graphRegistry || !this.provider.capabilities.reads.refs) {
      return branchFailure(
        'versionCapabilityDisabled',
        'Version ref lifecycle reads are unavailable for this document.',
        operation,
      );
    }
    if (requiresWrite && !this.provider.capabilities.writes.updateRefs) {
      return branchFailure(
        'versionCapabilityDisabled',
        'Version ref lifecycle writes are disabled for this document.',
        operation,
      );
    }

    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return branchFailure(
          'versionCapabilityDisabled',
          'Visible version graph registry is unavailable for branch lifecycle operations.',
          operation,
        );
      }

      const graph = await this.provider.openGraph(
        namespaceForRegistry(registryRead.registry),
        this.provider.accessContext,
      );

      return { ok: true, service: graph };
    } catch {
      return branchFailure(
        'versionCapabilityDisabled',
        'Visible version graph could not be opened for branch lifecycle operations.',
        operation,
      );
    }
  }
}

export function createProviderBackedBranchLifecycleService(
  options: ProviderBackedBranchLifecycleServiceOptions,
): ProviderBackedBranchLifecycleService {
  return new ProviderBackedBranchLifecycleService(options);
}

function toDeleteCapableBranchGraphStore(
  service: VersionGraphStore,
): DeleteCapableBranchGraphStore | null {
  const method = (service as Partial<DeleteCapableBranchGraphStore>).deleteBranch;
  if (typeof method !== 'function') return null;
  return {
    deleteBranch: (input) => Reflect.apply(method, service, [input]) as Promise<DeleteBranchResult>,
  };
}

function branchFailure(
  code: BranchServiceErrorCode,
  message: string,
  operation: BranchProviderOperation,
): Extract<OpenBranchServiceResult, { readonly ok: false }> {
  const diagnostics = [diagnostic(code, message, operation)];
  return {
    ok: false,
    result: Object.freeze({
      ok: false,
      error: Object.freeze({ code, message, diagnostics }),
      diagnostics,
    }),
  };
}

function diagnostic(
  code: string,
  message: string,
  operation: BranchProviderOperation,
): VersionDiagnostic {
  return Object.freeze({
    code,
    severity: 'error',
    message,
    details: Object.freeze({ operation, mutationGuarantee: 'no-write-attempted' }),
  });
}
