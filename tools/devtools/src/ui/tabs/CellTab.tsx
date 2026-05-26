import React, { useCallback, useState, useSyncExternalStore } from 'react';
import type { DevToolsDataSource } from './types';

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

function parseCellAddress(input: string): { row: number; col: number } | null {
  // Try "B3" format (letter column, 1-based row)
  const match = input
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{1,3})(\d+)$/);
  if (match) {
    let col = 0;
    for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { row: parseInt(match[2], 10) - 1, col: col - 1 };
  }
  // Try "row,col" format (0-based)
  const parts = input.split(',').map((s) => parseInt(s.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { row: parts[0], col: parts[1] };
  }
  return null;
}

interface CellTabProps {
  dataSource: DevToolsDataSource;
}

export function CellTab({ dataSource }: CellTabProps): React.ReactElement {
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const subscribe = useCallback((cb: () => void) => dataSource.subscribe(cb), [dataSource]);

  const cellData = useSyncExternalStore(subscribe, () => dataSource.getCellSnapshot());

  const handleInspect = useCallback(() => {
    const parsed = parseCellAddress(address);
    if (!parsed) {
      setError('Invalid address. Use "B3" or "row,col" (0-based)');
      return;
    }
    setError(null);
    dataSource.requestCellSnapshot(parsed.row, parsed.col);
  }, [address, dataSource]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleInspect();
    },
    [handleInspect],
  );

  const inputStyle: React.CSSProperties = {
    padding: '4px 8px',
    background: '#2a2a2a',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e0e0e0',
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    width: 100,
    outline: 'none',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '4px 10px',
    background: '#3a3a3a',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e0e0e0',
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Input bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="B3 or 2,1"
          style={inputStyle}
        />
        <button onClick={handleInspect} style={buttonStyle}>
          Inspect
        </button>
        {error && <span style={{ color: '#e06c75', fontSize: 10 }}>{error}</span>}
      </div>

      {/* Cell data */}
      {cellData && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Identity */}
          <div
            style={{
              padding: 8,
              background: '#252525',
              borderRadius: 4,
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#e5c07b', fontSize: 12 }}>
              Cell ({cellData.row}, {cellData.col})
              <span style={{ color: '#666', fontWeight: 400, marginLeft: 8, fontSize: 10 }}>
                viewport: {cellData.viewportId}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <PropRow
                label="Value Type"
                value={
                  <span style={{ color: VALUE_TYPE_COLORS[cellData.valueType] ?? '#888' }}>
                    {VALUE_TYPE_LABELS[cellData.valueType] ?? `unknown(${cellData.valueType})`}
                  </span>
                }
              />
              <PropRow label="Number Value" value={String(cellData.numberValue)} />
              <PropRow label="Display Text" value={cellData.displayText ?? '(null)'} />
              <PropRow label="Error Text" value={cellData.errorText ?? '(none)'} />
              <PropRow label="Format Index" value={`#${cellData.formatIdx}`} />
              <PropRow
                label="Raw Flags"
                value={`0x${cellData.flags.toString(16).padStart(4, '0')}`}
              />
            </div>
          </div>

          {/* Flags */}
          <div
            style={{
              padding: 8,
              background: '#252525',
              borderRadius: 4,
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#c678dd', fontSize: 11 }}>
              Flags
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <FlagBadge label="formula" active={cellData.hasFormula} />
              <FlagBadge label="comment" active={cellData.hasComment} />
              <FlagBadge label="sparkline" active={cellData.hasSparkline} />
              <FlagBadge label="hyperlink" active={cellData.hasHyperlink} />
              <FlagBadge label="checkbox" active={cellData.isCheckbox} />
              <FlagBadge label="validation-err" active={cellData.hasValidationError} />
            </div>
          </div>

          {/* Color overrides */}
          {(cellData.bgColorOverride || cellData.fontColorOverride) && (
            <div
              style={{
                padding: 8,
                background: '#252525',
                borderRadius: 4,
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, color: '#c678dd', fontSize: 11 }}>
                Color Overrides
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                {cellData.bgColorOverride && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        background: cellData.bgColorOverride,
                        border: '1px solid #555',
                      }}
                    />
                    <span style={{ fontSize: 10, color: '#888' }}>
                      bg: {cellData.bgColorOverride}
                    </span>
                  </div>
                )}
                {cellData.fontColorOverride && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        background: cellData.fontColorOverride,
                        border: '1px solid #555',
                      }}
                    />
                    <span style={{ fontSize: 10, color: '#888' }}>
                      font: {cellData.fontColorOverride}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Format */}
          {cellData.format && (
            <div
              style={{
                padding: 8,
                background: '#252525',
                borderRadius: 4,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, color: '#c678dd', fontSize: 11 }}>
                Format (#{cellData.formatIdx})
              </div>
              <pre
                style={{
                  fontSize: 10,
                  color: '#aaa',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(cellData.format, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {!cellData && !error && (
        <div style={{ color: '#666', fontSize: 11, padding: 8 }}>
          Enter a cell address (e.g. B3) and click Inspect
        </div>
      )}
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <span style={{ color: '#888', fontSize: 10 }}>{label}: </span>
      <span style={{ color: '#e0e0e0', fontSize: 11 }}>
        {typeof value === 'string' ? value : value}
      </span>
    </div>
  );
}

function FlagBadge({ label, active }: { label: string; active: boolean }): React.ReactElement {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 3,
        background: active ? 'rgba(152, 195, 121, 0.15)' : 'rgba(136, 136, 136, 0.1)',
        color: active ? '#98c379' : '#555',
        fontSize: 9,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}
