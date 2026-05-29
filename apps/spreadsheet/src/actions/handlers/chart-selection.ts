import type { ActionDependencies } from '@mog-sdk/contracts/actions';

export function selectChartObject(
  deps: ActionDependencies,
  chartId: string,
  options: { shiftKey?: boolean; ctrlKey?: boolean } = {},
): void {
  deps.commands.object.selectObject(chartId, options.shiftKey ?? false, options.ctrlKey ?? false);
}

export function deselectChartObjects(deps: ActionDependencies): void {
  deps.commands.object.deselectAll();
}
