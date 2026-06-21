import type { SheetId } from '@mog-sdk/contracts/core';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationAdmissionOptions } from '../../bridges/compute';
import type { DocumentContext } from '../../context/types';
import { createVersionOperationContext } from '../../api/internal/version-operation-context';

type NamedRangeMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

export type NamedRangeMutationOptionsInput =
  | MutationAdmissionOptions
  | (() => MutationAdmissionOptions | undefined)
  | undefined;

interface NamedRangeOperationInput {
  readonly operationIdPrefix: string;
  readonly sheetIds?: readonly SheetId[];
  readonly groupId?: string;
}

export function createNamedRangeMutationOptions(
  ctx: DocumentContext,
  input: NamedRangeOperationInput,
): NamedRangeMutationOptions {
  return {
    operationContext: createVersionOperationContext(ctx, {
      operationIdPrefix: input.operationIdPrefix,
      sheetIds: input.sheetIds,
      domainIds: ['named-ranges'],
      groupId: input.groupId,
    }),
  };
}

export function createGroupedNamedRangeMutationOptions(
  ctx: DocumentContext,
  input: Omit<NamedRangeOperationInput, 'groupId'>,
): () => NamedRangeMutationOptions {
  let groupId: string | undefined;
  return () => {
    const options = createNamedRangeMutationOptions(ctx, {
      ...input,
      groupId,
    });
    if (!groupId) {
      groupId = options.operationContext.operationId;
      return {
        ...options,
        operationContext: {
          ...options.operationContext,
          groupId,
        },
      };
    }
    return options;
  };
}

export function nextNamedRangeMutationOptions(
  input: NamedRangeMutationOptionsInput,
): MutationAdmissionOptions | undefined {
  return typeof input === 'function' ? input() : input;
}

export function namedRangeSheetIds(
  primary?: SheetId,
  fallback?: SheetId,
): readonly SheetId[] | undefined {
  const sheetId = primary ?? fallback;
  return sheetId ? [sheetId] : undefined;
}
