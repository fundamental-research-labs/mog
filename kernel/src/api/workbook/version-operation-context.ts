import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationAdmissionOptions } from '../../bridges/compute';
import { recordMutationAdmissionDiagnostic } from '../../bridges/compute/mutation-admission';
import type { DocumentContext } from '../../context';
import {
  createVersionOperationContext as createInternalVersionOperationContext,
  type CreateVersionOperationContextInput,
} from '../internal/version-operation-context';

export type { CreateVersionOperationContextInput };

export type VersionedMutationAdmissionOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

const VERSION_OPERATION_ID_PATTERN = /^(.+):(\d+):([1-9]\d*)$/;
const MISSING_OPERATION_ID_PREFIX = '<missing-operation-id-prefix>';

export function createVersionOperationContext(
  ctx: DocumentContext,
  input: CreateVersionOperationContextInput,
): VersionOperationContext {
  return createInternalVersionOperationContext(
    ctx,
    canonicalizeVersionOperationContextInput(ctx, input),
  );
}

export function createVersionMutationAdmissionOptions(
  ctx: DocumentContext,
  input: CreateVersionOperationContextInput,
): VersionedMutationAdmissionOptions {
  return {
    operationContext: createVersionOperationContext(ctx, input),
  };
}

function canonicalizeVersionOperationContextInput(
  ctx: DocumentContext,
  input: CreateVersionOperationContextInput,
): CreateVersionOperationContextInput {
  const operationIdPrefix = nonEmptyString(input.operationIdPrefix);
  if (!operationIdPrefix) {
    failVersionOperationContextIdentity(ctx, {
      command: MISSING_OPERATION_ID_PREFIX,
      message: 'VersionOperationContext requires a non-empty operationIdPrefix.',
    });
  }

  if (input.groupId === undefined) {
    return input;
  }

  const groupId = nonEmptyString(input.groupId);
  if (!groupId) {
    failVersionOperationContextIdentity(ctx, {
      command: operationIdPrefix,
      message: `Grouped VersionOperationContext for '${operationIdPrefix}' requires a non-empty groupId.`,
    });
  }

  const groupCommandIdentity = commandIdentityFromOperationId(groupId);
  if (!groupCommandIdentity) {
    failVersionOperationContextIdentity(ctx, {
      command: operationIdPrefix,
      message:
        `Grouped VersionOperationContext for '${operationIdPrefix}' requires groupId ` +
        `to be a VersionOperationContext operationId; received '${groupId}'.`,
    });
  }

  if (operationIdPrefix === groupCommandIdentity) {
    return input;
  }

  if (operationIdPrefix.startsWith(`${groupCommandIdentity}.`)) {
    return {
      ...input,
      operationIdPrefix: groupCommandIdentity,
    };
  }

  failVersionOperationContextIdentity(ctx, {
    command: operationIdPrefix,
    message:
      `Grouped VersionOperationContext for '${operationIdPrefix}' is not nested under ` +
      `operation group '${groupCommandIdentity}'.`,
  });
}

function commandIdentityFromOperationId(operationId: string): string | undefined {
  return VERSION_OPERATION_ID_PATTERN.exec(operationId)?.[1];
}

function failVersionOperationContextIdentity(
  ctx: DocumentContext,
  input: {
    readonly command: string;
    readonly message: string;
  },
): never {
  recordMutationAdmissionDiagnostic(ctx, {
    code: 'versioning.admission.missing-context',
    severity: 'error',
    command: input.command,
    message: input.message,
  });
  throw new Error(input.message);
}

function nonEmptyString(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}
