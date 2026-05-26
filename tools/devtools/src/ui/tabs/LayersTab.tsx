import React, { useCallback, useSyncExternalStore } from 'react';
import type { DevToolsDataSource } from './types';
import type { CanvasFrameEvent, StoreEntry } from '../../types';

const FONT_FAMILY = "'SF Mono', 'Fira Code', 'Consolas', monospace";

function getFrameColor(totalMs: number): string {
  if (totalMs < 8) return '#98c379'; // green - great
  if (totalMs < 16) return '#e5c07b'; // yellow - ok
  return '#e06c75'; // red - slow
}

interface LayersTabProps {
  dataSource: DevToolsDataSource;
}

export function LayersTab({ dataSource }: LayersTabProps): React.ReactElement {
  const subscribe = useCallback((cb: () => void) => dataSource.subscribe(cb), [dataSource]);

  const fullData = useSyncExternalStore(subscribe, () => dataSource.toJSON());

  // Get canvas frame events
  const canvasEvents: (StoreEntry & { event: CanvasFrameEvent })[] = [];
  if (fullData) {
    for (let i = fullData.events.length - 1; i >= 0 && canvasEvents.length < 50; i--) {
      const entry = fullData.events[i];
      if (entry.event.type === 'canvas') {
        canvasEvents.push(entry as StoreEntry & { event: CanvasFrameEvent });
      }
    }
  }

  const latestFrame = canvasEvents[0]?.event ?? null;

  // Compute max timing for bar scaling
  let maxLayerMs = 1;
  if (latestFrame) {
    for (const timing of Object.values(latestFrame.layerTimings)) {
      if (timing.lastMs > maxLayerMs) maxLayerMs = timing.lastMs;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Latest frame summary */}
      {latestFrame ? (
        <div
          style={{
            padding: 8,
            background: '#252525',
            borderRadius: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 11, color: '#e0e0e0' }}>Latest Frame</span>
            <span
              style={{
                padding: '2px 6px',
                borderRadius: 3,
                background: `${getFrameColor(latestFrame.totalMs)}22`,
                color: getFrameColor(latestFrame.totalMs),
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {latestFrame.totalMs.toFixed(1)}ms
            </span>
            <span style={{ color: '#666', fontSize: 10 }}>
              ({(1000 / Math.max(latestFrame.totalMs, 0.1)).toFixed(0)} fps potential)
            </span>
          </div>

          {/* Per-layer breakdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {Object.entries(latestFrame.layerTimings)
              .sort((a, b) => b[1].lastMs - a[1].lastMs)
              .map(([name, timing]) => (
                <div
                  key={name}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}
                >
                  <span
                    style={{
                      color: '#888',
                      minWidth: 110,
                      flexShrink: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {name}
                  </span>
                  {/* Timing bar */}
                  <div
                    style={{
                      flex: 1,
                      height: 10,
                      background: '#1a1a1a',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max((timing.lastMs / maxLayerMs) * 100, 1)}%`,
                        background: getFrameColor(timing.lastMs),
                        borderRadius: 2,
                        transition: 'width 0.2s',
                      }}
                    />
                  </div>
                  {/* Values */}
                  <span
                    style={{ color: '#e0e0e0', minWidth: 45, textAlign: 'right', flexShrink: 0 }}
                  >
                    {timing.lastMs.toFixed(2)}ms
                  </span>
                  <span style={{ color: '#666', minWidth: 45, textAlign: 'right', flexShrink: 0 }}>
                    avg {timing.avgMs.toFixed(2)}
                  </span>
                  <span style={{ color: '#555', minWidth: 45, textAlign: 'right', flexShrink: 0 }}>
                    max {timing.maxMs.toFixed(2)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : (
        <div style={{ color: '#666', fontSize: 11, padding: 8 }}>
          No canvas frame events recorded. Start recording to capture frame data.
        </div>
      )}

      {/* Frame history */}
      {canvasEvents.length > 1 && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ color: '#888', fontSize: 10, fontWeight: 600, marginBottom: 4 }}>
            Frame History ({canvasEvents.length} frames)
          </div>
          {/* Mini sparkline using bars */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 1,
              height: 40,
              marginBottom: 8,
              padding: '0 2px',
            }}
          >
            {canvasEvents
              .slice(0, 40)
              .reverse()
              .map((entry) => {
                const ms = entry.event.totalMs;
                const height = Math.max(Math.min((ms / 33) * 40, 40), 2);
                return (
                  <div
                    key={entry.id}
                    title={`${ms.toFixed(1)}ms`}
                    style={{
                      flex: 1,
                      height,
                      background: getFrameColor(ms),
                      borderRadius: 1,
                      minWidth: 2,
                      maxWidth: 8,
                    }}
                  />
                );
              })}
          </div>
          {/* 16ms budget line label */}
          <div style={{ display: 'flex', gap: 12, fontSize: 9, color: '#666', marginBottom: 8 }}>
            <span>
              <span style={{ color: '#98c379' }}>{'\u25A0'}</span> &lt;8ms
            </span>
            <span>
              <span style={{ color: '#e5c07b' }}>{'\u25A0'}</span> 8-16ms
            </span>
            <span>
              <span style={{ color: '#e06c75' }}>{'\u25A0'}</span> &gt;16ms
            </span>
          </div>
          {/* Frame list */}
          {canvasEvents.slice(0, 20).map((entry) => {
            const evt = entry.event;
            const layers = Object.keys(evt.layerTimings).length;
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '2px 0',
                  fontSize: 10,
                  borderBottom: '1px solid #222',
                }}
              >
                <span
                  style={{
                    color: getFrameColor(evt.totalMs),
                    fontWeight: 600,
                    minWidth: 50,
                    textAlign: 'right',
                  }}
                >
                  {evt.totalMs.toFixed(1)}ms
                </span>
                <span style={{ color: '#888' }}>{layers} layers</span>
                <span style={{ color: '#555', fontSize: 9 }}>
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
