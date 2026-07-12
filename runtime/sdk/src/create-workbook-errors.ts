import { MogSdkError } from './public-kernel-facade';

export function invalidCreateWorkbookArgument(
  paramName: string,
  message: string,
  suggestion: string,
  received?: unknown,
): MogSdkError {
  return new MogSdkError('INVALID_ARGUMENT', message, {
    operation: 'createWorkbook',
    path: [paramName],
    suggestion,
    details: {
      paramName,
      ...(received !== undefined ? { received: String(received) } : {}),
    },
    diagnostics: {
      domain: 'SDK',
      property: paramName,
      issueCode: 'SDK_INVALID_CREATE_WORKBOOK_ARGUMENT',
      severity: 'error',
    },
  });
}
