import React, { useCallback, useState, useSyncExternalStore } from 'react';
import type { DevToolsDataSource } from './types';
import type { SceneGraphSnapshotObject, StoreEntry } from '../../types';

const FONT_FAMILY = "'SF Mono', 'Fira Code', 'Consolas', monospace";

const TYPE_COLORS: Record<string, string> = {
  picture: '#61afef',
  textbox: '#e5c07b',
  shape: '#c678dd',
  connector: '#56b6c2',
  chart: '#e06c75',
  ink: '#98c379',
  equation: '#d19a66',
  smartart: '#be5046',
  oleObject: '#888',
};

interface SceneGraphTabProps {
  dataSource: DevToolsDataSource;
}

export function SceneGraphTab({ dataSource }: SceneGraphTabProps): React.ReactElement {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const subscribe = useCallback((cb: () => void) => dataSource.subscribe(cb), [dataSource]);

  const snapshot = useSyncExternalStore(subscribe, () => dataSource.getSceneGraphSnapshot());

  const fullData = useSyncExternalStore(subscribe, () => dataSource.toJSON());

  const handleRefresh = useCallback(() => {
    dataSource.requestSceneGraphSnapshot();
  }, [dataSource]);

  const objects = snapshot?.objects ?? [];

  // Get recent scenegraph events from the event store
  const recentPatches: StoreEntry[] = [];
  if (fullData) {
    const events = fullData.events;
    for (let i = events.length - 1; i >= 0 && recentPatches.length < 15; i--) {
      if (events[i].event.type === 'scenegraph') {
        recentPatches.push(events[i]);
      }
    }
  }

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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={handleRefresh} style={buttonStyle}>
          Refresh
        </button>
        <span style={{ color: '#888', fontSize: 10 }}>
          {objects.length} object{objects.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Object list */}
      {objects.length > 0 ? (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {objects.map((obj) => (
            <div key={obj.id}>
              <div
                onClick={() => setExpandedId(expandedId === obj.id ? null : obj.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  borderBottom: '1px solid #2a2a2a',
                  cursor: 'pointer',
                  background: expandedId === obj.id ? '#2a2a2a' : 'transparent',
                }}
              >
                {/* Type badge */}
                <span
                  style={{
                    display: 'inline-block',
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: `${TYPE_COLORS[obj.type] ?? '#888'}22`,
                    color: TYPE_COLORS[obj.type] ?? '#888',
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.3px',
                    minWidth: 55,
                    textAlign: 'center',
                  }}
                >
                  {obj.type}
                </span>

                {/* ID */}
                <span
                  style={{
                    color: '#e0e0e0',
                    fontSize: 10,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {obj.id.length > 24 ? obj.id.slice(0, 23) + '\u2026' : obj.id}
                </span>

                {/* Bounds */}
                <span style={{ color: '#888', fontSize: 9, flexShrink: 0 }}>
                  {Math.round(obj.bounds.x)},{Math.round(obj.bounds.y)}{' '}
                  {Math.round(obj.bounds.width)}x{Math.round(obj.bounds.height)}
                </span>

                {/* Z-index */}
                <span style={{ color: '#666', fontSize: 9, minWidth: 24, textAlign: 'right' }}>
                  z{obj.zIndex}
                </span>

                {/* Visibility */}
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: obj.visible ? '#98c379' : '#e06c75',
                    flexShrink: 0,
                  }}
                />

                {/* Locked */}
                {obj.locked && <span style={{ color: '#e5c07b', fontSize: 9 }}>L</span>}
              </div>

              {/* Expanded detail */}
              {expandedId === obj.id && (
                <div
                  style={{
                    padding: '6px 12px',
                    background: '#252525',
                    fontSize: 10,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 3,
                  }}
                >
                  <div>
                    <span style={{ color: '#888' }}>ID: </span>
                    <span style={{ color: '#e0e0e0', wordBreak: 'break-all' }}>{obj.id}</span>
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Type: </span>
                    <span style={{ color: TYPE_COLORS[obj.type] ?? '#888' }}>{obj.type}</span>
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Bounds: </span>({obj.bounds.x.toFixed(1)},{' '}
                    {obj.bounds.y.toFixed(1)}) {obj.bounds.width.toFixed(1)} x{' '}
                    {obj.bounds.height.toFixed(1)}
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Z-Index: </span>
                    {obj.zIndex}
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Visible: </span>
                    {obj.visible ? 'yes' : 'no'}
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Locked: </span>
                    {obj.locked ? 'yes' : 'no'}
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Opacity: </span>
                    {obj.opacity}
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Rotation: </span>
                    {obj.rotation}deg
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>Group: </span>
                    {obj.groupId ?? '(none)'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : snapshot ? (
        <div style={{ color: '#666', fontSize: 11, padding: 8 }}>
          No floating objects in document
        </div>
      ) : (
        <div style={{ color: '#666', fontSize: 11, padding: 8 }}>
          Click Refresh to load scene graph
        </div>
      )}

      {/* Patch event log */}
      {recentPatches.length > 0 && (
        <div
          style={{ borderTop: '1px solid #444', paddingTop: 8, maxHeight: 150, overflow: 'auto' }}
        >
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, marginBottom: 4 }}>
            Recent Patches
          </div>
          {recentPatches.map((entry) => {
            const evt = entry.event;
            if (evt.type !== 'scenegraph') return null;
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  gap: 6,
                  padding: '2px 0',
                  fontSize: 10,
                  borderBottom: '1px solid #222',
                }}
              >
                <span style={{ color: '#888', minWidth: 50, flexShrink: 0 }}>
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ color: '#e0e0e0' }}>
                  {evt.patches
                    .map((p) => `${p.kind} ${p.objectType ?? ''}:${p.objectId.slice(0, 8)}`)
                    .join(', ')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
