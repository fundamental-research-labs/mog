import { useCallback, useMemo } from 'react';
import { Button } from '@mog/shell/components/ui';

import { useActiveSheetId, useUIStore } from '../../../infra/context';
import { usePivotTables } from '../../../hooks/data/use-pivot-tables';

export function PivotAnalyzeRibbon() {
  const activeSheetId = useActiveSheetId();
  const { pivotTables, selectedPivotId, refreshPivotTable } = usePivotTables({
    sheetId: activeSheetId,
  });
  const startEditingPivot = useUIStore((s) => s.startEditingPivot);
  const selectedPivot = useMemo(
    () => pivotTables.find((pivot) => pivot.config.id === selectedPivotId) ?? null,
    [pivotTables, selectedPivotId],
  );
  const canRefreshSelectedPivot = selectedPivot?.capabilities.canRefresh ?? false;

  const openFields = useCallback(() => {
    if (selectedPivotId) startEditingPivot(selectedPivotId);
  }, [selectedPivotId, startEditingPivot]);

  const refresh = useCallback(() => {
    if (!selectedPivot || !canRefreshSelectedPivot) return;
    refreshPivotTable(selectedPivot.config.id);
  }, [selectedPivot, canRefreshSelectedPivot, refreshPivotTable]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={openFields} disabled={!selectedPivotId}>
        Field List
      </Button>
      <Button
        variant="secondary"
        onClick={refresh}
        disabled={!selectedPivotId || !canRefreshSelectedPivot}
      >
        Refresh
      </Button>
    </div>
  );
}

export function PivotDesignRibbon() {
  const selectedPivotId = useUIStore((s) => s.pivot.selectedPivotId);
  const startEditingPivot = useUIStore((s) => s.startEditingPivot);

  const openFields = useCallback(() => {
    if (selectedPivotId) startEditingPivot(selectedPivotId);
  }, [selectedPivotId, startEditingPivot]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={openFields} disabled={!selectedPivotId}>
        Field List
      </Button>
    </div>
  );
}
