import '@testing-library/jest-dom';

import { render, screen, within } from '@testing-library/react';
import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import { VersionHistoryDiffPreview } from '../VersionHistoryDiffPreview';

const BASE_COMMIT_ID =
  'commit:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_COMMIT_ID =
  'commit:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('VersionHistoryDiffPreview', () => {
  it('renders semantic changes as compact unified diff rows', () => {
    render(
      <VersionHistoryDiffPreview
        diffPreview={{
          base: BASE_COMMIT_ID,
          target: TARGET_COMMIT_ID,
          page: semanticDiffPage(),
        }}
      />,
    );

    const viewer = screen.getByTestId('version-history-diff-viewer');
    expect(viewer).toHaveAccessibleName('Diff viewer');
    expect(viewer).toHaveTextContent('Changes');
    expect(viewer).not.toHaveTextContent('Diff Viewer');
    expect(viewer).toHaveTextContent('aaaaaaaaaaaa...bbbbbbbbbbbb');
    expect(viewer).toHaveTextContent('Cell A1');
    expect(viewer).toHaveTextContent('cells value');

    const changeList = within(viewer).getByTestId('version-history-diff-change-list');
    expect(within(changeList).getByLabelText('Before: Blank')).toBeInTheDocument();
    expect(within(changeList).getByLabelText('After: 42')).toBeInTheDocument();
  });
});

function semanticDiffPage(): VersionSemanticDiffPage {
  return {
    items: [
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
    limit: 50,
    readRevision: { kind: 'counter', value: '4' },
    order: 'semantic-change-order',
  };
}
