import { useEffect, useState } from 'react';

import type { WorkbookSettings } from '@mog-sdk/contracts/core';

import { useWorkbook } from '../../infra/context';

function deriveStructureLocked(settings: WorkbookSettings): boolean {
  if (!settings.isWorkbookProtected) return false;
  return settings.workbookProtectionOptions?.structure ?? true;
}

export function useWorkbookStructureProtection(): boolean {
  const wb = useWorkbook();
  const [isLocked, setIsLocked] = useState<boolean>(() =>
    deriveStructureLocked(wb.mirror.getWorkbookSettings()),
  );

  useEffect(() => {
    const unsubscribe = wb.on('workbook:settings-changed', (event) => {
      if (
        event.changedKey === 'isWorkbookProtected' ||
        event.changedKey === 'workbookProtectionOptions'
      ) {
        setIsLocked(deriveStructureLocked(event.settings));
      }
    });
    return unsubscribe;
  }, [wb]);

  return isLocked;
}
