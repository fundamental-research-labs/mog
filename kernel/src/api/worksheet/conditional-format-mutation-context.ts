import type { SheetId } from '@mog-sdk/contracts/api';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationAdmissionOptions } from '../../bridges/compute';
import type { DocumentContext } from '../../context';
import { createVersionOperationContext } from '../internal/version-operation-context';

export type ConditionalFormatMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

const CONDITIONAL_FORMATTING_DOMAIN_IDS = ['conditional-formatting'] as const;

export function createConditionalFormatMutationOptionsFactory(
  ctx: DocumentContext,
  sheetId: SheetId,
): {
  create: (operationIdPrefix: string, groupId?: string) => ConditionalFormatMutationOptions;
  grouped: (operationIdPrefix: string) => () => ConditionalFormatMutationOptions;
} {
  const create = (operationIdPrefix: string, groupId?: string) =>
    createConditionalFormatMutationOptions(ctx, sheetId, operationIdPrefix, groupId);
  return {
    create,
    grouped: (operationIdPrefix: string) =>
      createGroupedConditionalFormatMutationOptions(create, operationIdPrefix),
  };
}

function createConditionalFormatMutationOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
  operationIdPrefix: string,
  groupId?: string,
): ConditionalFormatMutationOptions {
  return {
    operationContext: createVersionOperationContext(ctx, {
      operationIdPrefix,
      sheetIds: [sheetId],
      domainIds: CONDITIONAL_FORMATTING_DOMAIN_IDS,
      groupId,
    }),
  };
}

function createGroupedConditionalFormatMutationOptions(
  create: (operationIdPrefix: string, groupId?: string) => ConditionalFormatMutationOptions,
  operationIdPrefix: string,
): () => ConditionalFormatMutationOptions {
  let nextOptions = ensureConditionalFormatMutationGroup(create(operationIdPrefix));
  const groupId = nextOptions.operationContext.groupId;
  return () => {
    const options = nextOptions;
    nextOptions = create(operationIdPrefix, groupId);
    return options;
  };
}

function ensureConditionalFormatMutationGroup(
  options: ConditionalFormatMutationOptions,
): ConditionalFormatMutationOptions {
  const groupId = options.operationContext.groupId ?? options.operationContext.operationId;
  return {
    operationContext: {
      ...options.operationContext,
      groupId,
    },
  };
}
