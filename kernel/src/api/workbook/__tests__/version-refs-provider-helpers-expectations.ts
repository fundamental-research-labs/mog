import type { VersionGraphInitializeResult } from '../../../document/version-store/provider';

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectNoWriteFailure(
  result: unknown,
  code: string,
  data: Readonly<Record<string, unknown>> = {},
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            mutationGuarantee: 'no-write-attempted',
            ...data,
          }),
        }),
      ]),
    },
  });
}

export function expectNoDiagnosticLeak(result: unknown, ...secrets: readonly string[]): void {
  const serialized = JSON.stringify(result) ?? '';
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}
