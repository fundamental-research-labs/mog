type WorkbookRefreshEvent = 'sheet:renamed' | 'sheet:deleted';

type WorkbookRefreshSource = {
  on(event: WorkbookRefreshEvent, handler: () => void): () => void;
};

export const FORMULA_BAR_WORKBOOK_REFRESH_EVENTS: readonly WorkbookRefreshEvent[] = [
  'sheet:renamed',
  'sheet:deleted',
];

export function subscribeToFormulaBarWorkbookRefreshes(
  wb: WorkbookRefreshSource,
  refresh: () => void,
): () => void {
  const unsubscribes = FORMULA_BAR_WORKBOOK_REFRESH_EVENTS.map((event) => wb.on(event, refresh));
  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}
