export function expectMergeReviewFailure(value: unknown, operation: string, code: string): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ]),
    },
  });
}

export function expectInvalidMergeReviewOptions(
  value: unknown,
  operation: string,
  options: readonly string[],
): void {
  expectInvalidMergeReviewRequest(value, operation);
  expect(diagnosticOptions(value)).toEqual(expect.arrayContaining(options));
}

export function expectInvalidMergeReviewRequest(value: unknown, operation: string): void {
  expectMergeReviewFailure(value, operation, 'VERSION_INVALID_OPTIONS');
  expectPublicRedactedDiagnostics(value, operation);
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

function expectPublicRedactedDiagnostics(value: unknown, operation: string): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: expect.any(String),
          severity: 'error',
          message: expect.any(String),
          owner: 'version-store',
          data: expect.objectContaining({
            operation,
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ]),
    },
  });
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('"issueCode"');
  expect(serialized).not.toContain('"safeMessage"');
  expect(serialized).not.toContain('"redacted":false');
}

function diagnosticOptions(value: unknown): string[] {
  const diagnostics =
    (value as { readonly error?: { readonly diagnostics?: readonly PublicDiagnostic[] } }).error
      ?.diagnostics ?? [];
  return diagnostics
    .map((diagnostic) => diagnostic.data?.payload?.option)
    .filter((option): option is string => typeof option === 'string');
}

type PublicDiagnostic = {
  readonly data?: {
    readonly payload?: {
      readonly option?: unknown;
    };
  };
};
