import { useCallback } from 'react';
import { Button } from '@mog/shell/components/ui';

import { useActiveSheetId, useUIStore, useWorkbook } from '../../../infra/context';

export function PivotAnalyzeRibbon() {
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const selectedPivotId = useUIStore((s) => s.pivot.selectedPivotId);
  const startEditingPivot = useUIStore((s) => s.startEditingPivot);

  const openFields = useCallback(() => {
    if (selectedPivotId) startEditingPivot(selectedPivotId);
  }, [selectedPivotId, startEditingPivot]);

  const refresh = useCallback(() => {
    if (!selectedPivotId || selectedPivotId.startsWith('imported:')) return;
    void workbook.getSheetById(activeSheetId).pivots.refresh(selectedPivotId);
  }, [activeSheetId, selectedPivotId, workbook]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={openFields} disabled={!selectedPivotId}>
        Field List
      </Button>
      <Button
        variant="secondary"
        onClick={refresh}
        disabled={!selectedPivotId || selectedPivotId.startsWith('imported:')}
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
