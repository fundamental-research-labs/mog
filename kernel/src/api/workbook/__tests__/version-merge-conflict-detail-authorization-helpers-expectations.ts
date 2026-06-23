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

export function expectDiagnosticMessages(value: unknown, messages: readonly string[]): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining(
        messages.map((message) => expect.objectContaining({ message })),
      ),
    },
  });
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}
