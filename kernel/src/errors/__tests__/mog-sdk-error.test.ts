import type { MogSdkErrorCode } from '@mog-sdk/contracts/sdk';

import {
  KernelError,
  MogSdkError,
  mapKernelCodeToSdkCode,
  toMogSdkError,
  type KernelErrorCode,
} from '..';
import { chartNotFound, chartTargetAmbiguous } from '../api';

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
  ['OBJ_CHART_TARGET_AMBIGUOUS', 'CONFLICT'],
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

  it('preserves complete agent feedback when converting chartNotFound', () => {
    const kernelError = chartNotFound('chart-missing');

    const sdkError = toMogSdkError(kernelError, 'workbook.activeSheet.charts.update');

    expect(sdkError).toMatchObject({
      name: 'MogSdkError',
      code: 'NOT_FOUND',
      operation: 'workbook.activeSheet.charts.update',
      path: ['chartTarget'],
      suggestion:
        'Use ws.charts.list() to inspect available chart IDs and names, or api.describe("ws.charts") for chart API discovery',
      details: {
        resourceType: 'chart',
        resourceId: 'chart-missing',
        received: 'chart-missing',
        reason: 'not-found',
      },
      diagnostics: {
        domain: 'OBJ',
        property: 'chartTarget',
        issueCode: 'OBJ_CHART_NOT_FOUND',
        severity: 'error',
      },
    });
    expect(sdkError.cause).toBe(kernelError);
    expect(sdkError.toJSON()).toMatchObject({
      code: 'NOT_FOUND',
      operation: 'workbook.activeSheet.charts.update',
      path: ['chartTarget'],
      suggestion: sdkError.suggestion,
      details: { resourceType: 'chart', resourceId: 'chart-missing' },
      diagnostics: { issueCode: 'OBJ_CHART_NOT_FOUND' },
    });
  });

  it('maps chart target ambiguity to a rich public conflict', () => {
    const error = chartTargetAmbiguous('Revenue', [
      { id: 'chart-1', name: 'Revenue', matchedBy: ['name'] },
      { id: 'chart-2', name: 'Revenue', matchedBy: ['name'] },
    ]);

    expect(toMogSdkError(error, 'workbook.activeSheet.charts.update')).toMatchObject({
      code: 'CONFLICT',
      path: ['chartTarget'],
      suggestion: expect.stringContaining('{ id: "chart-1" }'),
      details: {
        resourceType: 'chart',
        received: 'Revenue',
        reason: 'ambiguous-target',
        candidates: [
          { id: 'chart-1', name: 'Revenue', matchedBy: ['name'] },
          { id: 'chart-2', name: 'Revenue', matchedBy: ['name'] },
        ],
      },
      diagnostics: {
        property: 'chartTarget',
        issueCode: 'OBJ_CHART_TARGET_AMBIGUOUS',
      },
    });
  });

  it('preserves structured KernelError feedback across package realms', () => {
    const foreignKernelError = Object.assign(new Error('Chart "foreign-chart" not found'), {
      name: 'KernelError',
      code: 'OBJ_CHART_NOT_FOUND' as const,
      context: { resourceType: 'chart', resourceId: 'foreign-chart' },
      path: ['chartId'],
      suggestion: 'Pass a stable chart ID.',
    });

    expect(toMogSdkError(foreignKernelError, 'workbook.charts.update')).toMatchObject({
      code: 'NOT_FOUND',
      operation: 'workbook.charts.update',
      path: ['chartId'],
      suggestion: 'Pass a stable chart ID.',
      details: { resourceType: 'chart', resourceId: 'foreign-chart' },
      diagnostics: { issueCode: 'OBJ_CHART_NOT_FOUND' },
    });
  });
});
