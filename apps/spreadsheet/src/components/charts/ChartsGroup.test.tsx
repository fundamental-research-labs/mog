import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  GroupRenderModeProvider,
  RibbonCollapseProvider,
} from '../../chrome/toolbar/collapse/context';
import { ChartsGroup } from './ChartsGroup';

jest.mock('./ChartTypesDropdownButton', () => ({
  ChartTypesDropdownButton: () => <button aria-label="Charts">Charts</button>,
}));

jest.mock('./ChartTypeButton', () => ({
  ChartTypeButton: ({ category }: { category: { label: string } }) => (
    <button aria-label={`Insert ${category.label} Chart`}>{category.label}</button>
  ),
}));

describe('ChartsGroup responsive layout', () => {
  const noop = jest.fn();

  beforeEach(() => {
    noop.mockClear();
  });

  function renderChartsGroup({
    mode,
    containerWidth = 1920,
  }: {
    mode: 'full' | 'compact';
    containerWidth?: number;
  }) {
    render(
      <RibbonCollapseProvider value={{ level: 0, containerWidth }}>
        <GroupRenderModeProvider value={mode}>
          <ChartsGroup onInsertChart={noop} />
        </GroupRenderModeProvider>
      </RibbonCollapseProvider>,
    );
  }

  it('keeps the chart catalog but removes category shortcuts in compact mode', () => {
    renderChartsGroup({ mode: 'compact' });

    expect(screen.getByRole('button', { name: 'Charts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert Column Chart' })).toBeNull();
  });

  it('removes category shortcuts in full mode when the ribbon container is not wide enough', () => {
    renderChartsGroup({ mode: 'full', containerWidth: 1700 });

    expect(screen.getByRole('button', { name: 'Charts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert Column Chart' })).toBeNull();
  });

  it('keeps category shortcuts in full mode on wide ribbon containers', () => {
    renderChartsGroup({ mode: 'full', containerWidth: 1800 });

    expect(screen.getByRole('button', { name: 'Charts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert Column Chart' })).toBeInTheDocument();
  });
});
