import { chartNotFound } from '../../../../errors/api';
import { MogSdkError } from '../../../../errors/mog-sdk-error';
import { createWorkbook } from '../../../workbook/create-workbook';
import { MogDocumentFactory } from '../../mog-document-factory';
import { withPublicSdkErrorBoundary } from '../../../public-sdk-error-boundary';
import { DocumentFactory } from '../../../../public-document-factory';

class NestedWorkbookApi {
  readonly plainResult = { status: 'ok', values: [1, 2, 3] };

  failSync(): never {
    throw chartNotFound('sync-missing');
  }

  async failAsync(): Promise<never> {
    throw chartNotFound('async-missing');
  }

  readPlainResult() {
    return this.plainResult;
  }
}

describe('stable public SDK error boundary', () => {
  const nested = new NestedWorkbookApi();
  const plainResult = { rows: [{ value: 1 }] };
  const root = {
    nested,
    getNested: () => nested,
    getPlainResult: () => plainResult,
  };
  const bounded = withPublicSdkErrorBoundary(root, 'workbook');

  it('normalizes synchronous KernelError with the precise operation path', () => {
    expect(() => bounded.nested.failSync()).toThrow(MogSdkError);

    try {
      bounded.nested.failSync();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'NOT_FOUND',
        operation: 'workbook.nested.failSync',
        path: ['chartTarget'],
        suggestion: expect.any(String),
        details: { resourceType: 'chart', resourceId: 'sync-missing' },
        diagnostics: {
          property: 'chartTarget',
          issueCode: 'OBJ_CHART_NOT_FOUND',
        },
      });
    }
  });

  it('normalizes asynchronous KernelError rejections', async () => {
    await expect(bounded.nested.failAsync()).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'NOT_FOUND',
      operation: 'workbook.nested.failAsync',
      path: ['chartTarget'],
      details: { resourceType: 'chart', resourceId: 'async-missing' },
      diagnostics: { issueCode: 'OBJ_CHART_NOT_FOUND' },
    });
  });

  it('preserves identity on one route while keeping alias operation paths precise', () => {
    expect(bounded.nested).toBe(bounded.nested);
    expect(bounded.getNested()).toBe(bounded.getNested());
    expect(bounded.getNested()).not.toBe(bounded.nested);
    expect(bounded.getNested).toBe(bounded.getNested);

    let aliasError: unknown;
    let propertyError: unknown;
    try {
      bounded.getNested().failSync();
    } catch (error) {
      aliasError = error;
    }
    try {
      bounded.nested.failSync();
    } catch (error) {
      propertyError = error;
    }
    expect(aliasError).toMatchObject({ operation: 'workbook.getNested.failSync' });
    expect(propertyError).toMatchObject({ operation: 'workbook.nested.failSync' });
  });

  it('returns plain result records and arrays without proxying or cloning them', () => {
    expect(bounded.getPlainResult()).toBe(plainResult);
    expect(bounded.nested.readPlainResult()).toBe(nested.plainResult);
    expect(bounded.getPlainResult().rows).toBe(plainResult.rows);
  });
});

describe('production stable workbook boundaries', () => {
  it('normalizes raw kernel feedback from MogDocument.workbook()', async () => {
    const document = await MogDocumentFactory.create({
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });
    try {
      const workbook = await document.workbook();
      await expect(workbook.activeSheet.charts.exportImage('missing-chart')).rejects.toMatchObject({
        name: 'MogSdkError',
        code: 'NOT_FOUND',
        operation: 'MogDocument.workbook.activeSheet.charts.exportImage',
        path: ['chartTarget'],
        details: { resourceType: 'chart', resourceId: 'missing-chart' },
        diagnostics: { issueCode: 'OBJ_CHART_NOT_FOUND' },
      });
    } finally {
      if (!document.isDisposed) await document.close();
    }
  });

  it('normalizes raw kernel feedback from the public DocumentHandle workbook', async () => {
    const handle = await DocumentFactory.create({
      environment: 'headless',
      userTimezone: 'UTC',
    });
    try {
      const workbook = await handle.workbook();
      await expect(workbook.activeSheet.charts.exportImage('missing-chart')).rejects.toMatchObject({
        name: 'MogSdkError',
        code: 'NOT_FOUND',
        operation: 'DocumentHandle.workbook.activeSheet.charts.exportImage',
        path: ['chartTarget'],
        diagnostics: { issueCode: 'OBJ_CHART_NOT_FOUND' },
      });
    } finally {
      if (!handle.isDisposed) await handle.disposeAsync();
    }
  });

  it('normalizes ambiguous chart targets from createWorkbook() with actionable recovery', async () => {
    const workbook = await createWorkbook();
    try {
      const worksheet = workbook.activeSheet;
      await worksheet.setCell('A1', 'Month');
      await worksheet.setCell('B1', 'Revenue');
      await worksheet.setCell('A2', 'Jan');
      await worksheet.setCell('B2', 12);
      const { chart } = await worksheet.charts.add({
        type: 'bar',
        name: 'Revenue chart',
        dataRange: 'A1:B2',
        anchorRow: 0,
        anchorCol: 3,
        width: 480,
        height: 300,
      });
      const duplicate = await worksheet.charts.duplicate({ id: chart.id });

      await expect(worksheet.charts.setLegendVisible('Revenue chart', false)).rejects.toMatchObject(
        {
          name: 'MogSdkError',
          code: 'CONFLICT',
          operation: 'workbook.activeSheet.charts.setLegendVisible',
          path: ['chartTarget'],
          suggestion: expect.stringContaining(`{ id: "${chart.id}" }`),
          details: {
            resourceType: 'chart',
            received: 'Revenue chart',
            reason: 'ambiguous-target',
            candidates: expect.arrayContaining([
              { id: chart.id, name: 'Revenue chart', matchedBy: ['name'] },
              { id: duplicate.chart.id, name: 'Revenue chart', matchedBy: ['name'] },
            ]),
          },
          diagnostics: {
            domain: 'OBJ',
            property: 'chartTarget',
            issueCode: 'OBJ_CHART_TARGET_AMBIGUOUS',
            severity: 'error',
          },
        },
      );
    } finally {
      await workbook.close('skipSave');
    }
  });
});
