import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationAdmissionOptions } from '../../bridges/compute';
import type { DocumentContext } from '../../context';
import {
  createVersionOperationContext,
  type CreateVersionOperationContextInput,
} from '../internal/version-operation-context';

export { createVersionOperationContext, type CreateVersionOperationContextInput };

export type VersionedMutationAdmissionOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

export function createVersionMutationAdmissionOptions(
  ctx: DocumentContext,
  input: CreateVersionOperationContextInput,
): VersionedMutationAdmissionOptions {
  return {
    operationContext: createVersionOperationContext(ctx, input),
  };
}
