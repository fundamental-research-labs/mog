import type { SheetId } from '@mog-sdk/contracts/core';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationAdmissionOptions } from '../../bridges/compute';
import type { DocumentContext } from '../../context/types';
import { createVersionOperationContext } from '../../api/internal/version-operation-context';

export type ChartMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

export type ChartMutationOptionsInput =
  | MutationAdmissionOptions
  | (() => MutationAdmissionOptions | undefined)
  | undefined;

interface ChartOperationInput {
  readonly operationIdPrefix: string;
  readonly sheetIds?: readonly SheetId[];
  readonly groupId?: string;
}

const CHART_SOURCE_RANGE_DOMAIN_IDS = ['charts.source-range'] as const;

export function createChartMutationOptions(
  ctx: DocumentContext,
  input: ChartOperationInput,
): ChartMutationOptions {
  return {
    operationContext: createVersionOperationContext(ctx, {
      operationIdPrefix: input.operationIdPrefix,
      sheetIds: input.sheetIds,
      domainIds: CHART_SOURCE_RANGE_DOMAIN_IDS,
      ...(input.groupId ? { groupId: input.groupId } : {}),
    }),
  };
}

export function createGroupedChartMutationOptions(
  ctx: DocumentContext,
  input: Omit<ChartOperationInput, 'groupId'>,
): () => ChartMutationOptions {
  let nextOptions = ensureChartMutationGroup(createChartMutationOptions(ctx, input));
  const groupId = nextOptions.operationContext.groupId;
  return () => {
    const options = nextOptions;
    nextOptions = createChartMutationOptions(ctx, {
      ...input,
      groupId,
    });
    return options;
  };
}

export function nextChartMutationOptions(
  input: ChartMutationOptionsInput,
): MutationAdmissionOptions | undefined {
  return typeof input === 'function' ? input() : input;
}

function ensureChartMutationGroup(options: ChartMutationOptions): ChartMutationOptions {
  const groupId = options.operationContext.groupId ?? options.operationContext.operationId;
  return {
    operationContext: {
      ...options.operationContext,
      groupId,
    },
  };
}
