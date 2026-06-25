import type { VersionCapability, VersionResult } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { proposalCapabilityFailure } from './version-proposal-capabilities';
import { getAttachedVersionProposalService } from './version-proposal-service-discovery';
import {
  methodUnavailableDiagnostic,
  proposalFailure,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-proposal-service-diagnostics';
import { mapProposalServiceResult } from './version-proposal-service-results';
import type {
  ProposalOperationInput,
  VersionProposalPublicOperation,
} from './version-proposal-types';

export async function callProposalService<
  Operation extends VersionProposalPublicOperation,
  TResult,
>(
  ctx: DocumentContext,
  operation: Operation,
  input: ProposalOperationInput<Operation>,
  requiredCapabilities: readonly VersionCapability[],
): Promise<VersionResult<TResult>> {
  const capabilityFailure = proposalCapabilityFailure<TResult>(
    ctx,
    operation,
    requiredCapabilities,
  );
  if (capabilityFailure) return capabilityFailure;

  const proposalService = getAttachedVersionProposalService(ctx);
  if (!proposalService)
    return proposalFailure(operation, [serviceUnavailableDiagnostic(operation)]);

  const method = proposalService[operation] as
    | ((input: ProposalOperationInput<Operation>) => Promise<unknown> | unknown)
    | undefined;
  if (!method) return proposalFailure(operation, [methodUnavailableDiagnostic(operation)]);

  try {
    return mapProposalServiceResult(operation, await method(input));
  } catch {
    return proposalFailure(operation, [providerErrorDiagnostic(operation)]);
  }
}
