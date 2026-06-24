import type { RemoteCursorDescriptor } from '../types';

export function getRemoteCursorReadbacks(): RemoteCursorDescriptor[] {
  try {
    const shell = (window as any).__SHELL__;
    if (!shell?.documentManager) return [];

    const activeFileId = shell.store?.getState?.()?.activeFileId;
    if (!activeFileId) return [];

    const sidecar = shell.documentManager.getSidecar(activeFileId);
    if (!sidecar?.participants) return [];

    const out: RemoteCursorDescriptor[] = [];
    for (const [participantId, state] of sidecar.participants as ReadonlyMap<string, any>) {
      if (!state.selection) continue;
      const sel = state.selection;
      const selection =
        sel.ranges && sel.ranges.length > 0
          ? sel.ranges
          : sel.endRow != null && sel.endCol != null
            ? [
                {
                  startRow: sel.startRow ?? sel.row,
                  startCol: sel.startCol ?? sel.col,
                  endRow: sel.endRow,
                  endCol: sel.endCol,
                },
              ]
            : [{ startRow: sel.row, startCol: sel.col, endRow: sel.row, endCol: sel.col }];
      out.push({
        userId: participantId,
        name: state.displayName ?? 'Unknown',
        color: state.color ?? '#888',
        activeCell: { row: sel.row, col: sel.col },
        selection,
        sheetId: sel.sheetId,
        isEditing: !!state.editing,
        ...(state.editing
          ? { editingCell: { row: state.editing.row, col: state.editing.col } }
          : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}
