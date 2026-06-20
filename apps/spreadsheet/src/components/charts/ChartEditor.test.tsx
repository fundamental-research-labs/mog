import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { ChartConfig } from '@mog/charts';
import type { ChartAppModel } from '@mog-sdk/contracts/data/chart-app-model';

import { ChartEditor } from './ChartEditor';

const BASE_CONFIG: ChartConfig = {
  type: 'column',
  dataRange: 'A1:B4',
};

describe('ChartEditor', () => {
  beforeAll(() => {
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => undefined;
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => undefined;
    }
  });

  function renderEditor() {
    render(
      <ChartEditor
        config={BASE_CONFIG}
        onChange={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
  }

  it('exposes the visible panel root for chart editor probes', () => {
    renderEditor();

    const panel = screen.getByTestId('chart-editor-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Edit Chart');
  });

  it('renders the column variant picker as a Radix Select trigger and listbox', async () => {
    const user = userEvent.setup();
    renderEditor();

    const panel = screen.getByTestId('chart-editor-panel');
    const trigger = panel.querySelector('button[role="combobox"]');
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    expect(trigger).toHaveAttribute('data-state', 'closed');
    expect(trigger).toHaveTextContent('Default');

    await user.click(trigger as HTMLButtonElement);

    expect(trigger).toHaveAttribute('data-state', 'open');
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Clustered' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Stacked' })).toBeInTheDocument();
  });

  it('routes legend visibility through the semantic callback', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onSetLegendVisible = jest.fn();

    render(
      <ChartEditor
        config={{ ...BASE_CONFIG, legend: { show: true, visible: true, position: 'bottom' } }}
        onChange={onChange}
        onSetLegendVisible={onSetLegendVisible}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Legend' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show legend' }));

    expect(onSetLegendVisible).toHaveBeenCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses app-model axis titles and routes edits through the semantic callback', async () => {
    const onChange = jest.fn();
    const onSetAxisTitle = jest.fn();
    const appModel = {
      axes: {
        category: { title: 'Imported Category' },
        value: { title: 'Imported Value' },
      },
      legend: { visible: false },
      title: { visible: true },
      source: { supportsOrientationSwitch: true },
    } as ChartAppModel;

    render(
      <ChartEditor
        config={BASE_CONFIG}
        appModel={appModel}
        onChange={onChange}
        onSetAxisTitle={onSetAxisTitle}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Axis' }));
    const input = screen.getByPlaceholderText('X-axis title');
    expect(input).toHaveValue('Imported Category');

    fireEvent.change(input, { target: { value: 'Month' } });

    expect(input).toHaveValue('Month');
    expect(onSetAxisTitle).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onSetAxisTitle).toHaveBeenCalledWith('category', 'Month');
    expect(onSetAxisTitle).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats null app-model axis titles as authoritative over legacy config', async () => {
    const appModel = {
      axes: {
        category: { title: null },
        value: { title: null },
      },
      legend: { visible: true },
      title: { visible: true },
      source: { supportsOrientationSwitch: true },
    } as ChartAppModel;

    render(
      <ChartEditor
        config={{
          ...BASE_CONFIG,
          axis: {
            xAxis: { title: 'Stale X' },
            yAxis: { title: 'Stale Y' },
          },
        }}
        appModel={appModel}
        onChange={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Axis' }));

    expect(screen.getByPlaceholderText('X-axis title')).toHaveValue('');
    expect(screen.getByPlaceholderText('Y-axis title')).toHaveValue('');
  });

  it('commits fallback axis title edits on blur', async () => {
    const onChange = jest.fn();

    render(
      <ChartEditor
        config={BASE_CONFIG}
        onChange={onChange}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Axis' }));
    const input = screen.getByPlaceholderText('X-axis title');

    fireEvent.change(input, { target: { value: 'Month' } });

    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      axis: expect.objectContaining({
        categoryAxis: expect.objectContaining({ title: 'Month' }),
        xAxis: expect.objectContaining({ title: 'Month' }),
      }),
    });
  });
});
