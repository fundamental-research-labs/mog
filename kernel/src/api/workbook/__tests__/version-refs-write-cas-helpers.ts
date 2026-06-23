export function expectRedactedExpectedHeadConflict(
  diagnostics: unknown,
  extraData: Record<string, unknown> = {},
): void {
  expect(diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'VERSION_REF_CONFLICT',
        data: expect.objectContaining({
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            actualHead: 'redacted',
            actualRefRevision: 'redacted',
            conflict: 'expectedHeadMismatch',
          }),
          ...extraData,
        }),
      }),
    ]),
  );
}
