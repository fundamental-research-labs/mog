import React, { useCallback, useState, useSyncExternalStore } from 'react';
import type { DevToolsDataSource } from './types';
import type { ViewportSnapshotCell, ViewportSnapshotViewport } from '../../types';

const FONT_FAMILY = "'SF Mono', 'Fira Code', 'Consolas', monospace";

const VALUE_TYPE_LABELS: Record<number, string> = {
  0: 'null',
  1: 'number',
  2: 'text',
  3: 'bool',
  4: 'error',
};

const VALUE_TYPE_COLORS: Record<number, string> = {
  0: '#666',
  1: '#61afef',
  2: '#e0e0e0',
  3: '#98c379',
  4: '#e06c75',
};

interface ViewportTabProps {
  dataSource: DevToolsDataSource;
}

export function ViewportTab({ dataSource }: ViewportTabProps): React.ReactElement {
  const [selectedViewport, setSelectedViewport] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<ViewportSnapshotCell | null>(null);

  const subscribe = useCallback((cb: () => void) => dataSource.subscribe(cb), [dataSource]);

  const snapshot = useSyncExternalStore(subscribe, () => dataSource.getViewportSnapshot());

  const handleRefresh = useCallback(() => {
    dataSource.requestViewportSnapshot();
  }, [dataSource]);

  const viewports = snapshot?.viewports ?? [];
  const activeVp = selectedViewport
    ? viewports.find((v) => v.id === selectedViewport)
    : (viewports[0] ?? null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={handleRefresh}
          style={{
            padding: '4px 10px',
            background: '#3a3a3a',
            border: '1px solid #555',
            borderRadius: 4,
            color: '#e0e0e0',
            fontFamily: FONT_FAMILY,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
        {viewports.length > 1 && (
          <select
            value={activeVp?.id ?? ''}
            onChange={(e) => setSelectedViewport(e.target.value)}
            style={{
              padding: '4px 6px',
              background: '#2a2a2a',
              border: '1px solid #555',
              borderRadius: 4,
              color: '#e0e0e0',
              fontFamily: FONT_FAMILY,
              fontSize: 11,
            }}
          >
            {viewports.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </select>
        )}
        {!snapshot && (
          <span style={{ color: '#666', fontSize: 11 }}>Click Refresh to load viewport data</span>
        )}
      </div>

      {/* Summary */}
      {activeVp && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 4,
            padding: 8,
            background: '#252525',
            borderRadius: 4,
            fontSize: 10,
          }}
        >
          <div>
            <span style={{ color: '#888' }}>Viewport: </span>
            <span style={{ color: '#61afef' }}>{activeVp.id}</span>
          </div>
          <div>
            <span style={{ color: '#888' }}>Origin: </span>
            {activeVp.startRow},{activeVp.startCol}
          </div>
          <div>
            <span style={{ color: '#888' }}>Size: </span>
            {activeVp.rows} x {activeVp.cols}
          </div>
          <div>
            <span style={{ color: '#888' }}>Cells: </span>
            {activeVp.cellCount}
          </div>
          <div>
            <span style={{ color: '#888' }}>Gen: </span>
            {activeVp.generation}
          </div>
          <div>
            <span style={{ color: '#888' }}>Formats: </span>
            {activeVp.formatPaletteSize}
          </div>
        </div>
      )}

      {/* Cell Grid */}
      {activeVp && activeVp.sampleCells.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {renderCellGrid(activeVp, selectedCell, setSelectedCell)}
        </div>
      )}

      {/* Cell Detail */}
      {selectedCell && (
        <div
          style={{
            padding: 8,
            background: '#252525',
            borderRadius: 4,
            fontSize: 10,
            borderTop: '1px solid #444',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: '#e5c07b' }}>
            Cell ({selectedCell.row}, {selectedCell.col})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <div>
              <span style={{ color: '#888' }}>Type: </span>
              <span style={{ color: VALUE_TYPE_COLORS[selectedCell.valueType] ?? '#888' }}>
                {VALUE_TYPE_LABELS[selectedCell.valueType] ?? selectedCell.valueType}
              </span>
            </div>
            <div>
              <span style={{ color: '#888' }}>Formula: </span>
              {selectedCell.hasFormula ? 'yes' : 'no'}
            </div>
            <div>
              <span style={{ color: '#888' }}>Number: </span>
              {selectedCell.numberValue}
            </div>
            <div>
              <span style={{ color: '#888' }}>Format: </span>#{selectedCell.formatIdx}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={{ color: '#888' }}>Display: </span>
              <span style={{ color: '#e0e0e0' }}>{selectedCell.displayText ?? '(null)'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderCellGrid(
  vp: ViewportSnapshotViewport,
  selectedCell: ViewportSnapshotCell | null,
  setSelectedCell: (cell: ViewportSnapshotCell | null) => void,
): React.ReactElement {
  // Build a grid from sample cells
  const cellMap = new Map<string, ViewportSnapshotCell>();
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  for (const cell of vp.sampleCells) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
    if (cell.row < minRow) minRow = cell.row;
    if (cell.row > maxRow) maxRow = cell.row;
    if (cell.col < minCol) minCol = cell.col;
    if (cell.col > maxCol) maxCol = cell.col;
  }

  if (vp.sampleCells.length === 0) return <div style={{ color: '#666' }}>No cells in buffer</div>;

  const rows: number[] = [];
  for (let r = minRow; r <= maxRow; r++) rows.push(r);
  const cols: number[] = [];
  for (let c = minCol; c <= maxCol; c++) cols.push(c);

  return (
    <table
      style={{
        borderCollapse: 'collapse',
        fontSize: 10,
        fontFamily: FONT_FAMILY,
        width: '100%',
      }}
    >
      <thead>
        <tr>
          <th
            style={{
              padding: '2px 4px',
              borderBottom: '1px solid #444',
              borderRight: '1px solid #444',
              color: '#666',
              fontSize: 9,
              position: 'sticky',
              top: 0,
              background: '#1e1e1e',
            }}
          ></th>
          {cols.map((c) => (
            <th
              key={c}
              style={{
                padding: '2px 6px',
                borderBottom: '1px solid #444',
                color: '#888',
                fontSize: 9,
                fontWeight: 500,
                position: 'sticky',
                top: 0,
                background: '#1e1e1e',
                minWidth: 60,
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <td
              style={{
                padding: '2px 4px',
                borderRight: '1px solid #444',
                borderBottom: '1px solid #2a2a2a',
                color: '#888',
                fontSize: 9,
                fontWeight: 500,
                position: 'sticky',
                left: 0,
                background: '#1e1e1e',
              }}
            >
              {r}
            </td>
            {cols.map((c) => {
              const cell = cellMap.get(`${r},${c}`);
              const isSelected = selectedCell?.row === r && selectedCell?.col === c;
              return (
                <td
                  key={c}
                  onClick={() => setSelectedCell(cell ?? null)}
                  style={{
                    padding: '2px 6px',
                    borderBottom: '1px solid #2a2a2a',
                    cursor: cell ? 'pointer' : 'default',
                    background: isSelected ? '#333' : 'transparent',
                    color: cell ? (VALUE_TYPE_COLORS[cell.valueType] ?? '#888') : '#333',
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cell ? (cell.displayText ?? VALUE_TYPE_LABELS[cell.valueType] ?? '') : ''}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
