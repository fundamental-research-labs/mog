import {
  PROPOSAL_OPERATIONS,
  type ProposalOperationInput,
  type VersionProposalPublicOperation,
} from './version-proposal-types';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedVersionProposalService = {
  [Operation in VersionProposalPublicOperation]?: (
    input: ProposalOperationInput<Operation>,
  ) => MaybePromise<unknown>;
};

export function hasAttachedVersionProposalService(ctxOrServices: unknown): boolean {
  const service = getAttachedVersionProposalService(ctxOrServices);
  return Boolean(service && PROPOSAL_OPERATIONS.every((method) => service[method]));
}

export function getAttachedVersionProposalService(
  ctxOrServices: unknown,
): AttachedVersionProposalService | null {
  const services = getAttachedVersionServices(ctxOrServices);
  if (!isRecord(services)) return null;

  const proposalService: AttachedVersionProposalService = {};
  for (const candidate of [
    { value: services.proposalService },
    { value: services.versionProposalService },
    { value: services.agentProposalService },
    { value: services.proposalWorkspaceService },
    { value: services.proposalMetadataStore, getProposalById: true },
    { value: services.proposalStore, getProposalById: true },
    { value: services.publicService },
    { value: services },
  ]) {
    bindProposalMethods(candidate.value, proposalService, candidate.getProposalById === true);
  }

  return Object.keys(proposalService).length > 0 ? proposalService : null;
}

function getAttachedVersionServices(ctxOrServices: unknown): unknown {
  if (!isRecord(ctxOrServices)) return null;
  return (
    ctxOrServices.versioning ?? ctxOrServices.versionStore ?? ctxOrServices.version ?? ctxOrServices
  );
}

function bindProposalMethods(
  value: unknown,
  target: AttachedVersionProposalService,
  getProposalById: boolean,
): void {
  for (const operation of PROPOSAL_OPERATIONS) {
    if (target[operation]) continue;
    const method = bindMethod(value, operation);
    if (!method) continue;
    if (operation === 'getProposal' && getProposalById) {
      target[operation] = ((input: unknown) => {
        const proposalId =
          isRecord(input) && typeof input.proposalId === 'string' ? input.proposalId : input;
        return method(proposalId);
      }) as never;
      continue;
    }
    target[operation] = ((input: unknown) => method(input)) as never;
  }
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
