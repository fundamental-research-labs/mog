/**
 * ExtensionHostContainer
 *
 * Container component that wires ExtensionHost with XState selection context.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 */

import { useMemo, useEffect, useState } from 'react';
import { useActiveSheetId, useSelectionRanges, useWorkbook } from '../../internal-api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { ExtensionHost } from '../../extensions/components';

export function ExtensionHostContainer({
  extension,
  onStateChange,
  onSessionEstablished,
}: {
  extension: import('../../extensions/types').ExtensionInstance;
  onStateChange: (
    state: import('../../extensions/types').ExtensionLifecycleState,
    error?: string | null,
  ) => void;
  onSessionEstablished: (sessionId: string) => void;
}) {
  const activeSheetId = useActiveSheetId() as string;
  const wb = useWorkbook();
  const ranges = useSelectionRanges();

  // Get sheet name via unified Workbook/Worksheet API (async — getName returns Promise)
  const [activeSheetName, setActiveSheetName] = useState<string>('Sheet1');
  useEffect(() => {
    let cancelled = false;
    void wb
      .getSheetById(toSheetId(activeSheetId))
      .getName()
      .then((name) => {
        if (!cancelled) setActiveSheetName(name);
      });
    return () => {
      cancelled = true;
    };
  }, [wb, activeSheetId]);

  const context = useMemo(
    () => ({
      activeSheetId,
      activeSheetName,
      selection:
        ranges.length > 0
          ? {
              range: `${String.fromCharCode(65 + ranges[0].startCol)}${ranges[0].startRow + 1}`,
            }
          : null,
    }),
    [activeSheetId, activeSheetName, ranges],
  );

  return (
    <ExtensionHost
      extension={extension}
      onStateChange={onStateChange}
      onSessionEstablished={onSessionEstablished}
      context={context}
    />
  );
}
