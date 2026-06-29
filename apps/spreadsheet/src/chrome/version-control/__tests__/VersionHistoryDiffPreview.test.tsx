import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import type { VersionDiffGroup, VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import { VersionHistoryDiffPreview } from '../VersionHistoryDiffPreview';
import { DIFF_GROUP_ID, versionDiffOverview } from './VersionHistoryPanel.test-utils';

const BASE_COMMIT_ID =
  'commit:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_COMMIT_ID =
  'commit:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('VersionHistoryDiffPreview', () => {
  it('renders no diff viewer while no enabled diff is selected', () => {
    render(
      <VersionHistoryDiffPreview
        onLoadMoreGroups={jest.fn()}
        onSelectGroup={jest.fn()}
        onLoadMoreDetail={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('version-history-diff-viewer')).not.toBeInTheDocument();
    expect(screen.queryByText('No diff loaded')).not.toBeInTheDocument();
  });

  it('renders semantic changes as compact unified diff rows', () => {
    const page = semanticDiffPage();
    render(
      <VersionHistoryDiffPreview
        diffPreview={{
          base: BASE_COMMIT_ID,
          target: TARGET_COMMIT_ID,
          overview: versionDiffOverview({
            baseCommitId: BASE_COMMIT_ID,
            targetCommitId: TARGET_COMMIT_ID,
          }),
          activeGroupId: DIFF_GROUP_ID,
          detailPages: [page],
          detailItems: page.items,
          loadedDetailCount: page.items.length,
          loadedDetailPageCount: 1,
          hasMoreDetail: false,
          loadingGroups: false,
          loadingDetail: false,
          inlineDetailMode: false,
          inlineDetailItems: [],
          loadingInlineDetail: false,
          inlineDetailHasMore: false,
        }}
        onLoadMoreGroups={jest.fn()}
        onSelectGroup={jest.fn()}
        onLoadMoreDetail={jest.fn()}
      />,
    );

    const viewer = screen.getByTestId('version-history-diff-viewer');
    expect(viewer).toHaveAccessibleName('Diff viewer');
    expect(viewer).toHaveTextContent('Changes');
    expect(viewer).not.toHaveTextContent('Diff Viewer');
    expect(viewer).toHaveTextContent('aaaaaaaaaaaa...bbbbbbbbbbbb');
    expect(viewer).toHaveTextContent('Cell A1');
    expect(viewer).not.toHaveTextContent('Cell sheet-1!A1');
    expect(viewer).not.toHaveTextContent('cells value');

    const viewport = within(viewer).getByTestId('version-history-diff-detail-viewport');
    expect(viewport).toHaveStyle('height: 76px');
    expect(viewer).toHaveTextContent('Sheet1!A1');
    expect(within(viewport).getByLabelText('Before: Blank')).toBeInTheDocument();
    expect(within(viewport).getByLabelText('After: 42')).toBeInTheDocument();
  });

  it('renders same-address cell changes with distinct sheet labels', () => {
    const page = semanticDiffPage([
      cellDiffEntry({
        changeId: 'north-a1',
        sheetId: 'sheet-north',
        sheetName: 'North',
        address: 'A1',
        value: '10',
      }),
      cellDiffEntry({
        changeId: 'south-a1',
        sheetId: 'sheet-south',
        sheetName: 'South',
        address: 'A1',
        value: '20',
      }),
    ]);

    render(
      <VersionHistoryDiffPreview
        diffPreview={{
          base: BASE_COMMIT_ID,
          target: TARGET_COMMIT_ID,
          overview: versionDiffOverview({
            baseCommitId: BASE_COMMIT_ID,
            targetCommitId: TARGET_COMMIT_ID,
            exactTotalChanges: page.items.length,
          }),
          activeGroupId: DIFF_GROUP_ID,
          detailPages: [page],
          detailItems: page.items,
          loadedDetailCount: page.items.length,
          loadedDetailPageCount: 1,
          hasMoreDetail: false,
          loadingGroups: false,
          loadingDetail: false,
          inlineDetailMode: false,
          inlineDetailItems: [],
          loadingInlineDetail: false,
          inlineDetailHasMore: false,
        }}
        onLoadMoreGroups={jest.fn()}
        onSelectGroup={jest.fn()}
        onLoadMoreDetail={jest.fn()}
      />,
    );

    const viewport = screen.getByTestId('version-history-diff-detail-viewport');
    expect(within(viewport).getByText('Cell North!A1')).toBeInTheDocument();
    expect(within(viewport).getByText('Cell South!A1')).toBeInTheDocument();
    expect(within(viewport).queryByText('Cell A1')).not.toBeInTheDocument();
  });

  it('does not expose typed sheet ids in grouped address labels when no sheet name is available', () => {
    const page = semanticDiffPage();
    render(
      <VersionHistoryDiffPreview
        diffPreview={{
          base: BASE_COMMIT_ID,
          target: TARGET_COMMIT_ID,
          overview: versionDiffOverview({
            baseCommitId: BASE_COMMIT_ID,
            targetCommitId: TARGET_COMMIT_ID,
            groups: [
              cellRangeGroup({
                groupId: DIFF_GROUP_ID,
                sheetId: 'sheet-north',
                address: 'A1',
              }),
            ],
          }),
          activeGroupId: DIFF_GROUP_ID,
          detailPages: [page],
          detailItems: page.items,
          loadedDetailCount: page.items.length,
          loadedDetailPageCount: 1,
          hasMoreDetail: false,
          loadingGroups: false,
          loadingDetail: false,
          inlineDetailMode: false,
          inlineDetailItems: [],
          loadingInlineDetail: false,
          inlineDetailHasMore: false,
        }}
        onLoadMoreGroups={jest.fn()}
        onSelectGroup={jest.fn()}
        onLoadMoreDetail={jest.fn()}
      />,
    );

    const groupList = screen.getByTestId('version-history-diff-group-list');
    expect(groupList).toHaveTextContent('Sheet name unavailable!A1');
    expect(groupList).not.toHaveTextContent('sheet-north!A1');
    expect(groupList).not.toHaveTextContent('Sheet1!A1');
  });

  it('renders row and column insertions as spreadsheet structure changes', () => {
    const page = semanticDiffPage([
      rowColumnInsertion({
        changeId: 'mutation-1:row:0',
        axis: 'row',
        index: 1,
        displayRef: '2:2',
      }),
      rowColumnInsertion({
        changeId: 'mutation-1:column:1',
        axis: 'column',
        index: 2,
        displayRef: 'C:C',
      }),
    ]);
    render(
      <VersionHistoryDiffPreview
        diffPreview={{
          base: BASE_COMMIT_ID,
          target: TARGET_COMMIT_ID,
          overview: versionDiffOverview({
            baseCommitId: BASE_COMMIT_ID,
            targetCommitId: TARGET_COMMIT_ID,
            exactTotalChanges: page.items.length,
          }),
          activeGroupId: DIFF_GROUP_ID,
          detailPages: [page],
          detailItems: page.items,
          loadedDetailCount: page.items.length,
          loadedDetailPageCount: 1,
          hasMoreDetail: false,
          loadingGroups: false,
          loadingDetail: false,
          inlineDetailMode: false,
          inlineDetailItems: [],
          loadingInlineDetail: false,
          inlineDetailHasMore: false,
        }}
        onLoadMoreGroups={jest.fn()}
        onSelectGroup={jest.fn()}
        onLoadMoreDetail={jest.fn()}
      />,
    );

    const viewer = screen.getByTestId('version-history-diff-viewer');
    expect(viewer).toHaveTextContent('Inserted row 2');
    expect(viewer).toHaveTextContent('Inserted column C');
    expect(viewer).not.toHaveTextContent('Row structure');
    expect(viewer).not.toHaveTextContent('Column structure');
    expect(viewer).not.toHaveTextContent('rows-columns order');
    expect(viewer).not.toHaveTextContent('Object (4)');

    const viewport = within(viewer).getByTestId('version-history-diff-detail-viewport');
    expect(within(viewport).getAllByLabelText('Before: Not present')).toHaveLength(2);
    expect(within(viewport).getByLabelText('After: Inserted row 2')).toBeInTheDocument();
    expect(within(viewport).getByLabelText('After: Inserted column C')).toBeInTheDocument();
  });

  it('renders direct accounting number formats with semantic labels', () => {
    const page = semanticDiffPage([
      {
        structural: {
          kind: 'metadata',
          changeId: 'mutation-1:cell-format:0',
          domain: 'cells.formats.direct',
          entityId: 'sheet-1!B3',
          propertyPath: ['format'],
        },
        before: { kind: 'value', value: null },
        after: {
          kind: 'value',
          value: {
            kind: 'object',
            fields: [
              {
                key: 'numberFormat',
                value: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
              },
            ],
          },
        },
        display: {
          address: { kind: 'value', value: 'B3' },
          entityLabel: { kind: 'value', value: 'Cell' },
        },
      },
    ]);
    render(
      <VersionHistoryDiffPreview
        diffPreview={{
          base: BASE_COMMIT_ID,
          target: TARGET_COMMIT_ID,
          overview: versionDiffOverview({
            baseCommitId: BASE_COMMIT_ID,
            targetCommitId: TARGET_COMMIT_ID,
            exactTotalChanges: page.items.length,
          }),
          activeGroupId: DIFF_GROUP_ID,
          detailPages: [page],
          detailItems: page.items,
          loadedDetailCount: page.items.length,
          loadedDetailPageCount: 1,
          hasMoreDetail: false,
          loadingGroups: false,
          loadingDetail: false,
          inlineDetailMode: false,
          inlineDetailItems: [],
          loadingInlineDetail: false,
          inlineDetailHasMore: false,
        }}
        onLoadMoreGroups={jest.fn()}
        onSelectGroup={jest.fn()}
        onLoadMoreDetail={jest.fn()}
      />,
    );

    const viewport = screen.getByTestId('version-history-diff-detail-viewport');
    expect(within(viewport).getByLabelText('Before: No direct format')).toBeInTheDocument();
    expect(
      within(viewport).getByLabelText('After: Number format: Accounting (USD)'),
    ).toBeInTheDocument();
    expect(viewport).not.toHaveTextContent('numberFormat: _($* #,##0.00_)');
  });
});

function semanticDiffPage(
  items: VersionSemanticDiffPage['items'] = [
    {
      structural: {
        kind: 'metadata',
        changeId: 'change-1',
        domain: 'cells',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
      },
      before: { kind: 'value', value: { kind: 'blank' } },
      after: { kind: 'value', value: '42' },
      display: {
        address: { kind: 'value', value: 'A1' },
        entityLabel: { kind: 'value', value: 'Cell' },
      },
    },
  ],
): VersionSemanticDiffPage {
  return {
    items,
    limit: 50,
    readRevision: { kind: 'counter', value: '4' },
    order: 'semantic-change-order',
  };
}

function cellDiffEntry({
  changeId,
  sheetId,
  sheetName,
  address,
  value,
}: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly sheetName: string;
  readonly address: string;
  readonly value: string;
}): VersionSemanticDiffPage['items'][number] {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells',
      entityId: `${sheetId}!${address}`,
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: { kind: 'blank' } },
    after: { kind: 'value', value },
    display: {
      sheetName: { kind: 'value', value: sheetName },
      address: { kind: 'value', value: address },
      entityLabel: { kind: 'value', value: 'Cell' },
    },
    historical: {
      cell: {
        sheetId,
        row: 0,
        column: 0,
      },
    },
  };
}

function cellRangeGroup({
  groupId,
  sheetId,
  address,
}: {
  readonly groupId: VersionDiffGroup['groupId'];
  readonly sheetId: string;
  readonly address: string;
}): VersionDiffGroup {
  return {
    groupId,
    key: {
      kind: 'cellRange',
      sheetId,
      domain: 'cells',
      operation: 'changed',
      rowStart: 0,
      rowEnd: 0,
      columnStart: 0,
      columnEnd: 0,
    },
    kind: 'cellRange',
    domain: 'cells',
    sheetId,
    address: { kind: 'value', value: address },
    operation: 'changed',
    changeCount: 1,
    countPrecision: 'exact',
    sampleChangeIds: ['change-1'],
    hasDetail: true,
    diagnostics: [],
  };
}

function rowColumnInsertion({
  changeId,
  axis,
  index,
  displayRef,
}: {
  readonly changeId: string;
  readonly axis: 'row' | 'column';
  readonly index: number;
  readonly displayRef: string;
}): VersionSemanticDiffPage['items'][number] {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'rows-columns',
      entityId: `sheet-1!${axis}:${index}`,
      propertyPath: ['order'],
    },
    before: { kind: 'value', value: null },
    after: {
      kind: 'value',
      value: {
        kind: 'object',
        fields: [
          { key: 'axis', value: axis },
          { key: 'sheetId', value: 'sheet-1' },
          { key: 'index', value: index },
          { key: 'displayRef', value: displayRef },
        ],
      },
    },
    display: {
      address: { kind: 'value', value: displayRef },
    },
  };
}
