import {
  inspectMaterializableMergeChange,
  isMaterializableMergeDomainReference,
} from '../version/merge/version-merge-materializer-support';
import {
  rowColumnChange,
  sheetNameChange,
  sheetTabColorChange,
} from './version-apply-merge-materializer-support-test-utils';

describe('WorkbookVersion applyMerge materializer support inspection', () => {
  it.each([
    {
      label: 'row insert',
      change: rowColumnChange('merge-row-insert', 'row', 1, 'insert'),
    },
    {
      label: 'row delete',
      change: rowColumnChange('merge-row-delete', 'row', 3, 'delete'),
    },
    {
      label: 'column insert',
      change: rowColumnChange('merge-column-insert', 'column', 4, 'insert'),
    },
    {
      label: 'column delete',
      change: rowColumnChange('merge-column-delete', 'column', 2, 'delete'),
    },
    {
      label: 'sheet rename',
      change: sheetNameChange(),
    },
    {
      label: 'sheet tab color',
      change: sheetTabColorChange(),
    },
  ])('accepts first-slice rows-columns $label merge changes', ({ change }) => {
    expect(inspectMaterializableMergeChange(change)).toEqual({ ok: true });
  });

  it('does not treat materializable matrix rows as support for structural domain aliases', () => {
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.values',
        domainId: 'rows-columns',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.values',
        domainId: 'sheet',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.values',
        domainId: 'row',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.formats.direct',
        domainId: 'sheets',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'sheets',
        domainId: 'sheet',
      }),
    ).toBe(true);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'sheets',
        domainId: 'sheets',
      }),
    ).toBe(true);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.formats.direct',
        domainId: 'cells.formats',
      }),
    ).toBe(true);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'rows-columns',
        domainId: 'rows-columns',
      }),
    ).toBe(true);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.formats.catalogs',
        domainId: 'cells.formats',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'pivots',
        domainId: 'pivots',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'tables',
        domainId: 'tables',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'filters.auto-filter',
        domainId: 'filters',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'charts.source-range',
        domainId: 'charts',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'floating-objects.anchors',
        domainId: 'floating-objects',
      }),
    ).toBe(false);
  });
});
