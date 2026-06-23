import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import { isVersioningRecord } from './version-checkout-rebind-utils';

export function checkoutResetOperationContext(
  operationContext: VersionOperationContext | undefined,
  versioning: Record<string, unknown>,
): VersionOperationContext | undefined {
  if (isVersionOperationContext(operationContext)) return operationContext;

  for (const candidate of checkoutOperationContextCandidates(versioning)) {
    if (isVersionOperationContext(candidate)) return candidate;
  }
  return undefined;
}

function checkoutOperationContextCandidates(
  versioning: Record<string, unknown>,
): readonly unknown[] {
  const semanticCapture = isVersioningRecord(versioning.semanticMutationCapture)
    ? versioning.semanticMutationCapture
    : {};
  return [
    versioning.checkoutOperationContext,
    versioning.operationContext,
    semanticCapture.checkoutOperationContext,
    semanticCapture.operationContext,
  ];
}

function isVersionOperationContext(value: unknown): value is VersionOperationContext {
  if (!isVersioningRecord(value)) return false;
  if (
    typeof value.operationId !== 'string' ||
    value.operationId.length === 0 ||
    typeof value.kind !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.domainIds) ||
    !value.domainIds.every((domainId) => typeof domainId === 'string') ||
    typeof value.capturePolicy !== 'string' ||
    typeof value.writeAdmissionMode !== 'string'
  ) {
    return false;
  }

  const author = value.author;
  return (
    isVersioningRecord(author) &&
    typeof author.authorId === 'string' &&
    author.authorId.length > 0 &&
    typeof author.actorKind === 'string'
  );
}
