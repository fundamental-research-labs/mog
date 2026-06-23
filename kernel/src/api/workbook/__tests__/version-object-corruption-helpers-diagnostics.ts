import {
  RAW_OBJECT_PREIMAGE_CANARY,
  RAW_OBJECT_PREIMAGE_PATH,
} from './version-object-corruption-helpers-constants';

export function expectRepairDiagnostic(
  result: unknown,
  expected: { readonly target: string; readonly code: string },
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: expected.target,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: expected.code,
          severity: 'error',
          data: expect.objectContaining({
            recoverability: 'repair',
            redacted: true,
          }),
        }),
      ]),
    },
  });
}

export function expectNoLeaks(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_OBJECT_PREIMAGE_CANARY);
  expect(serialized).not.toContain(RAW_OBJECT_PREIMAGE_PATH);
  expect(serialized).not.toContain('rawObjectPreimage');
}
