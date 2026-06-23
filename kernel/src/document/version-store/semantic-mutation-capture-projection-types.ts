import type { VersionSemanticValue } from '@mog-sdk/contracts/api';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition, DirectEditRange } from '../../bridges/compute/mutation-admission';

export interface SemanticMutationCaptureProjectionInput {
  readonly operation: string;
  readonly result: MutationResult;
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly operationContext?: VersionOperationContext;
}

export type VersionSemanticChangeRecord = {
  readonly structural: {
    readonly kind: 'metadata';
    readonly changeId: string;
    readonly domain: string;
    readonly entityId: string;
    readonly propertyPath: readonly string[];
  };
  readonly before: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly after: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly display?: {
    readonly address?: { readonly kind: 'value'; readonly value: string };
    readonly entityLabel?: { readonly kind: 'value'; readonly value: string };
  };
};

export type PendingSemanticMutation = {
  readonly sequence: number;
  readonly operation: string;
  readonly capturedAt: string;
  readonly operationContext?: VersionOperationContext;
  readonly directEdits: readonly DirectEditPosition[];
  readonly directEditRanges: readonly DirectEditRange[];
  readonly changes: readonly VersionSemanticChangeRecord[];
};
