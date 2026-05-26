import type { MogSdkErrorCode } from '@mog-sdk/contracts/sdk';

import { KernelError, MogSdkError, mapKernelCodeToSdkCode, type KernelErrorCode } from '..';

const REQUIRED_MAPPINGS = [
  ['API_UNSUPPORTED_OPERATION', 'INVALID_ARGUMENT'],
  ['DOC_LEGACY_OPTION_REJECTED', 'INVALID_ARGUMENT'],
  ['WRITE_GATE_BLOCKED', 'READ_ONLY'],
] as const satisfies readonly (readonly [KernelErrorCode, MogSdkErrorCode])[];

describe('MogSdkError kernel mapping', () => {
  it.each(REQUIRED_MAPPINGS)('maps %s to %s', (kernelCode, sdkCode) => {
    expect(mapKernelCodeToSdkCode(kernelCode)).toBe(sdkCode);
  });

  it.each(REQUIRED_MAPPINGS)('wraps %s as a stable SDK error', (kernelCode, sdkCode) => {
    const error = new KernelError(kernelCode, `test ${kernelCode}`);

    const sdkError = MogSdkError.fromKernelError(error);

    expect(sdkError.code).toBe(sdkCode);
    expect(sdkError.diagnostics).toEqual({
      domain: kernelCode.split('_')[0],
      issueCode: kernelCode,
      severity: 'error',
    });
  });
});
