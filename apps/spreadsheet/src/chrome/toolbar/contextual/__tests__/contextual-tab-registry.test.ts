import type { ContextualTabContext } from '../contextual-tab-registry';
import { getVisibleContextualTabs } from '../contextual-tab-registry';

function createContext(overrides: Partial<ContextualTabContext> = {}): ContextualTabContext {
  return {
    tableSelection: { isInTable: false },
    chartUI: { selectedChartId: null },
    objectInteraction: { selectedIds: [], selectedObjectType: null },
    slicerSelection: { selectedSlicerId: null },
    sparklineSelection: { hasSparklineInActiveCell: false },
    diagramSelection: { selectedDiagramId: null },
    pivotSelection: { selectedPivotId: null },
    ...overrides,
  } as ContextualTabContext;
}

describe('contextual tab registry', () => {
  it('shows chart contextual tabs from selected chart object type', () => {
    const visibleTabs = getVisibleContextualTabs(
      createContext({
        chartUI: { selectedChartId: null },
        objectInteraction: {
          selectedIds: ['chart-1'],
          selectedObjectType: 'chart',
        },
      }),
    );

    expect(visibleTabs.map((tab) => tab.id)).toEqual(['chart-design', 'chart-format']);
  });
});
