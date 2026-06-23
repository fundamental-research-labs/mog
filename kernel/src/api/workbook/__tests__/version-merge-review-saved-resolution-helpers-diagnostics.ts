export function expectMergeReviewFailure(value: unknown, code: string): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      target: 'workbook.version.getMergeConflictDetail',
      diagnostics: [
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation: 'getMergeConflictDetail' }),
          }),
        }),
      ],
    },
  });
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}
