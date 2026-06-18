import { jest } from '@jest/globals';

import { createChartCommands } from '../chart-commands';

describe('createChartCommands', () => {
  function setup() {
    const chartActor = { send: jest.fn() };
    const objectCommands = {
      selectObject: jest.fn(),
      deselectAll: jest.fn(),
      keyDelete: jest.fn(),
    };
    const commands = createChartCommands(chartActor, objectCommands);
    return { chartActor, objectCommands, commands };
  }

  it('routes chart selection through object interaction commands', () => {
    const { chartActor, objectCommands, commands } = setup();

    commands.select('chart-1');
    commands.addToSelection('chart-2');
    commands.toggleSelection('chart-3');

    expect(objectCommands.selectObject).toHaveBeenNthCalledWith(1, 'chart-1', false, false);
    expect(objectCommands.selectObject).toHaveBeenNthCalledWith(2, 'chart-2', true, false);
    expect(objectCommands.selectObject).toHaveBeenNthCalledWith(3, 'chart-3', false, true);
    expect(chartActor.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECT' }));
  });

  it('routes chart deselection and deletion through object interaction commands', () => {
    const { chartActor, objectCommands, commands } = setup();

    commands.deselect();
    commands.deselectAll();
    commands.delete();

    expect(objectCommands.deselectAll).toHaveBeenCalledTimes(2);
    expect(objectCommands.keyDelete).toHaveBeenCalledTimes(1);
    expect(chartActor.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE' }));
  });

  it('keeps chart-specific editing commands on the chart actor', () => {
    const { chartActor, commands } = setup();

    commands.startEdit();
    commands.stopEdit();
    commands.startTitleEdit('Revenue');

    expect(chartActor.send).toHaveBeenCalledWith({ type: 'START_EDIT' });
    expect(chartActor.send).toHaveBeenCalledWith({ type: 'STOP_EDIT' });
    expect(chartActor.send).toHaveBeenCalledWith({
      type: 'START_TITLE_EDIT',
      originalValue: 'Revenue',
    });
  });
});
