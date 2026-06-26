import { jest } from '@jest/globals';

import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import { CREATED_AT_MS, DOCUMENT_ID } from './version-operation-context-helpers-constants';

type DirectEditExpectation = {
  readonly sheetId: string;
  readonly row: number;
  readonly col: number;
};

type MutationCapture = {
  recordPreMutation: jest.Mock;
  recordMutationResult: jest.Mock;
};

export function clearCapture(capture: MutationCapture): void {
  capture.recordPreMutation.mockClear();
  capture.recordMutationResult.mockClear();
}

export function expectCapturedContext(
  capture: MutationCapture,
  expected: {
    operation: string;
    operationIdPrefix: string;
    domainIds: readonly string[];
    sheetIds?: readonly string[];
    directEdits?: readonly DirectEditExpectation[];
  },
): void {
  const operationContext = expect.objectContaining({
    operationId: expect.stringMatching(new RegExp(`^${escapeRegExp(expected.operationIdPrefix)}:`)),
    kind: 'mutation',
    author: expect.objectContaining({
      authorId: 'user-1',
      actorKind: 'user',
      sessionId: 'session-1',
    }),
    createdAt: new Date(CREATED_AT_MS).toISOString(),
    workbookId: DOCUMENT_ID,
    domainIds: [...expected.domainIds],
    ...(expected.sheetIds ? { sheetIds: [...expected.sheetIds] } : {}),
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  });
  const captureInput = expect.objectContaining({
    operation: expected.operation,
    operationContext,
    ...(expected.directEdits ? { directEdits: [...expected.directEdits] } : {}),
  });
  expect(capture.recordPreMutation).toHaveBeenCalledWith(captureInput);
  expect(capture.recordMutationResult).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: expected.operation,
      operationContext,
      ...(expected.directEdits ? { directEdits: [...expected.directEdits] } : {}),
    }),
  );
}

export function capturedPreMutationInputs(
  capture: Pick<MutationCapture, 'recordPreMutation'>,
): Array<{ operation: string; operationContext: VersionOperationContext }> {
  return capture.recordPreMutation.mock.calls.map(([input]) => input) as Array<{
    operation: string;
    operationContext: VersionOperationContext;
  }>;
}

export function expectGroupedCommandIdentity(
  inputs: readonly { operation: string; operationContext: VersionOperationContext }[],
  expected: {
    readonly operations: readonly string[];
    readonly operationIdPrefix: string;
    readonly rejectedOperationIdPrefix: string;
  },
): void {
  expect(inputs.map((input) => input.operation)).toEqual(expected.operations);
  const [outer, nested] = inputs.map((input) => input.operationContext);
  expect(outer?.groupId).toBe(outer?.operationId);
  expect(nested?.groupId).toBe(outer?.groupId);
  expect(outer?.operationId).toMatch(new RegExp(`^${escapeRegExp(expected.operationIdPrefix)}:`));
  expect(nested?.operationId).toMatch(new RegExp(`^${escapeRegExp(expected.operationIdPrefix)}:`));
  expect(nested?.operationId).not.toMatch(
    new RegExp(`^${escapeRegExp(expected.rejectedOperationIdPrefix)}:`),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
