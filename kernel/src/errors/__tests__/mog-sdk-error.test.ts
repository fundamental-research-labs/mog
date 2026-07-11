import type { MogSdkErrorCode } from '@mog-sdk/contracts/sdk';

import { KernelError, MogSdkError, mapKernelCodeToSdkCode, type KernelErrorCode } from '..';

const REQUIRED_MAPPINGS = [
  ['API_UNSUPPORTED_OPERATION', 'INVALID_ARGUMENT'],
  ['DOC_LEGACY_OPTION_REJECTED', 'INVALID_ARGUMENT'],
  ['WRITE_GATE_BLOCKED', 'READ_ONLY'],
  ['SLICER_NOT_FOUND', 'NOT_FOUND'],
  ['SLICER_ID_EXISTS', 'CONFLICT'],
  ['SLICER_SHEET_MISMATCH', 'INVALID_ARGUMENT'],
  ['CONDITIONAL_FORMAT_NOT_FOUND', 'NOT_FOUND'],
  ['CONDITIONAL_FORMAT_RULE_NOT_FOUND', 'NOT_FOUND'],
  ['VALIDATION_NOT_FOUND', 'NOT_FOUND'],
  ['FILTER_NOT_FOUND', 'NOT_FOUND'],
  ['FORM_CONTROL_NOT_FOUND', 'NOT_FOUND'],
  ['SPARKLINE_NOT_FOUND', 'NOT_FOUND'],
  ['SPARKLINE_GROUP_NOT_FOUND', 'NOT_FOUND'],
  ['HYPERLINK_NOT_FOUND', 'NOT_FOUND'],
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
