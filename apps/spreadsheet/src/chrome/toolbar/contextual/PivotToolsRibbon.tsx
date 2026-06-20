import { useCallback, useMemo } from 'react';
import { Button } from '@mog/shell/components/ui';

import { useActiveSheetId } from '../../../infra/context';
import { usePivotTables } from '../../../hooks/data/use-pivot-tables';

type PivotView = ReturnType<typeof usePivotTables>['pivotTables'][number];

function findSelectedPivot(
  pivotTables: PivotView[],
  selectedPivotId: string | null,
): PivotView | null {
  return (
    pivotTables.find(
      (pivot) =>
        pivot.config.id === selectedPivotId ||
        pivot.alternateIds?.includes(selectedPivotId ?? '') === true,
    ) ?? null
  );
}

export function PivotAnalyzeRibbon() {
  const activeSheetId = useActiveSheetId();
  const { pivotTables, selectedPivotId, refreshPivotTable, startEditingPivot } = usePivotTables({
    sheetId: activeSheetId,
  });
  const selectedPivot = useMemo(
    () => findSelectedPivot(pivotTables, selectedPivotId),
    [pivotTables, selectedPivotId],
  );
  const canRefreshSelectedPivot = selectedPivot?.capabilities.canRefresh ?? false;

  const openFields = useCallback(() => {
    if (selectedPivot) startEditingPivot(selectedPivot.config.id);
  }, [selectedPivot, startEditingPivot]);

  const refresh = useCallback(() => {
    if (!selectedPivot || !canRefreshSelectedPivot) return;
    refreshPivotTable(selectedPivot.config.id);
  }, [selectedPivot, canRefreshSelectedPivot, refreshPivotTable]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={openFields} disabled={!selectedPivot}>
        Field List
      </Button>
      <Button
        variant="secondary"
        onClick={refresh}
        disabled={!selectedPivot || !canRefreshSelectedPivot}
      >
        Refresh
      </Button>
    </div>
  );
}

export function PivotDesignRibbon() {
  const activeSheetId = useActiveSheetId();
  const { pivotTables, selectedPivotId, startEditingPivot } = usePivotTables({
    sheetId: activeSheetId,
  });
  const selectedPivot = useMemo(
    () => findSelectedPivot(pivotTables, selectedPivotId),
    [pivotTables, selectedPivotId],
  );

  const openFields = useCallback(() => {
    if (selectedPivot) startEditingPivot(selectedPivot.config.id);
  }, [selectedPivot, startEditingPivot]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={openFields} disabled={!selectedPivot}>
        Field List
      </Button>
    </div>
  );
}
