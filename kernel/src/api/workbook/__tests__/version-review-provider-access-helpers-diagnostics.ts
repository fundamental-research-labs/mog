export function expectMergeReviewDiagnostic(
  value: unknown,
  operation: string,
  code: string,
  message: string,
): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code,
          message,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ],
    },
  });
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) {
    expect(serialized).not.toContain(canary);
  }
}
