import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';

export interface CreateVersionOperationContextInput {
  readonly operationIdPrefix: string;
  readonly workbookId?: string;
  readonly sheetIds?: readonly string[];
  readonly domainIds: readonly string[];
  readonly groupId?: string;
}

let nextOperationSequence = 1;

export function createVersionOperationContext(
  ctx: DocumentContext,
  input: CreateVersionOperationContextInput,
): VersionOperationContext {
  const scope = safeWorkbookLinkScope(ctx);
  const timestamp = safeClockNow(ctx);
  const createdAt = new Date(timestamp).toISOString();
  const authorId = nonEmptyString(scope?.actor) ?? 'unknown-user';
  const sessionId = nonEmptyString(scope?.requestingSessionId);
  return {
    operationId: `${input.operationIdPrefix}:${timestamp}:${nextOperationSequence++}`,
    kind: 'mutation',
    author: {
      authorId,
      actorKind: 'user',
      ...(sessionId ? { sessionId } : {}),
    },
    createdAt,
    ...(input.workbookId || scope?.requestingDocumentId
      ? { workbookId: input.workbookId ?? scope?.requestingDocumentId }
      : {}),
    ...(input.sheetIds ? { sheetIds: [...input.sheetIds] } : {}),
    domainIds: [...input.domainIds],
    ...(input.groupId ? { groupId: input.groupId } : {}),
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  };
}

function safeClockNow(ctx: DocumentContext): number {
  try {
    const value = ctx.clock?.now?.();
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

function safeWorkbookLinkScope(ctx: DocumentContext) {
  try {
    return ctx.workbookLinkScope?.();
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
