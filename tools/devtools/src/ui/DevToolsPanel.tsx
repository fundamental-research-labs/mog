import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DevToolsStatus, MachineSnapshot, RuntimeEvent, StoreEntry } from '../types';
import type { DevToolsDataSource } from './tabs/types';
import { CellTab } from './tabs/CellTab';
import { LayersTab } from './tabs/LayersTab';
import { SceneGraphTab } from './tabs/SceneGraphTab';
import { ViewportTab } from './tabs/ViewportTab';

// Re-export the data-source interface so existing consumers importing it
// from './DevToolsPanel' keep working. The canonical definition lives in
// `./tabs/types` to avoid a cycle between the panel and its tab children.
export type { DevToolsDataSource } from './tabs/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(1)}ms`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return `${diff}ms ago`;
  if (diff < 60_000) return `${(diff / 1000).toFixed(1)}s ago`;
  return `${Math.floor(diff / 60_000)}m ago`;
}

function getTypeBadgeColor(type: string): string {
  switch (type) {
    case 'actor':
      return '#61afef';
    case 'eventbus':
      return '#98c379';
    case 'render':
      return '#e5c07b';
    case 'canvas':
      return '#c678dd';
    case 'bridge':
      return '#e06c75';
    default:
      return '#888';
  }
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '\u2026';
}

function getEventDuration(evt: RuntimeEvent): number | null {
  switch (evt.type) {
    case 'bridge':
      return evt.durationMs;
    case 'render':
      return evt.actualDurationMs;
    case 'canvas':
      return evt.totalMs;
    case 'actor':
      return evt.durationMs ?? null;
    case 'eventbus':
    case 'viewport-buffer':
      return null;
    case 'action':
      return evt.durationMs;
    case 'receipt':
    case 'scenegraph':
      return null;
  }
}

function getEventName(evt: RuntimeEvent): string {
  switch (evt.type) {
    case 'actor':
      return `${evt.actorId}: ${evt.fromState ?? '?'} \u2192 ${evt.toState ?? '?'}`;
    case 'eventbus':
      return evt.eventType;
    case 'render':
      return `${evt.appId}/${evt.componentId} (${evt.phase})`;
    case 'canvas':
      return `frame ${evt.totalMs.toFixed(1)}ms`;
    case 'bridge':
      return `${evt.bridgeName}.${evt.method}()`;
    case 'viewport-buffer':
      return `viewport ${evt.viewportId} ${evt.kind}`;
    case 'action':
      return `${evt.action} ${evt.handled ? '\u2713' : '\u2717'}`;
    case 'receipt':
      return `${evt.receipts.length} receipt(s)`;
    case 'scenegraph':
      return `${evt.patches.length} patch(es)`;
    default:
      return (evt as RuntimeEvent).type;
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const FONT_FAMILY = "'SF Mono', 'Fira Code', 'Consolas', monospace";
const SLOW_THRESHOLD = 16;

const styles = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: '#e0e0e0',
    lineHeight: 1.4,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    background: 'rgba(30, 30, 30, 0.95)',
    borderBottom: '1px solid #444',
    userSelect: 'none' as const,
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 8px',
    background: '#3a3a3a',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e0e0e0',
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  recordButton: (recording: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 28,
    padding: '0 8px',
    background: recording ? 'rgba(255, 68, 68, 0.15)' : '#3a3a3a',
    border: `1px solid ${recording ? '#ff4444' : '#555'}`,
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: recording ? '#ff4444' : '#e0e0e0',
  }),
  recordIcon: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#ff4444',
    boxShadow: '0 0 6px rgba(255, 68, 68, 0.6)',
    animation: 'os-dt-pulse 1.5s ease-in-out infinite',
  },
  stopIcon: {
    width: 10,
    height: 10,
    borderRadius: 2,
    background: '#e0e0e0',
  },
  eventCount: {
    padding: '2px 6px',
    color: '#aaa',
    fontSize: 10,
    minWidth: 60,
    textAlign: 'center' as const,
  },
  panel: {
    flex: 1,
    background: 'rgba(30, 30, 30, 0.95)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #444',
    padding: '0 4px',
  },
  tab: (active: boolean) => ({
    padding: '6px 12px',
    cursor: 'pointer',
    color: active ? '#e0e0e0' : '#888',
    borderBottom: active ? '2px solid #61afef' : '2px solid transparent',
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    background: 'none',
    border: 'none',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid' as const,
    borderBottomColor: active ? '#61afef' : 'transparent',
  }),
  tabContent: {
    flex: 1,
    overflow: 'auto',
    padding: 8,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 11,
  },
  th: {
    textAlign: 'left' as const,
    padding: '4px 8px',
    borderBottom: '1px solid #444',
    color: '#888',
    fontWeight: 500,
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  td: {
    padding: '3px 8px',
    borderBottom: '1px solid #333',
  },
  badge: (color: string) => ({
    display: 'inline-block',
    padding: '1px 5px',
    borderRadius: 3,
    background: `${color}22`,
    color,
    fontSize: 9,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  }),
  stateIndicator: (color: string) => ({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: color,
    marginRight: 6,
  }),
  eventRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 0',
    borderBottom: '1px solid #2a2a2a',
  },
  eventTimestamp: {
    color: '#666',
    fontSize: 10,
    minWidth: 60,
    flexShrink: 0,
  },
  eventDetail: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  slowDuration: {
    color: '#e06c75',
    fontWeight: 600,
    minWidth: 55,
    textAlign: 'right' as const,
    flexShrink: 0,
  },
} as const;

// ---------------------------------------------------------------------------
// Types for internal state
// ---------------------------------------------------------------------------

type Tab = 'machines' | 'slowops' | 'events' | 'viewport' | 'cells' | 'scenegraph' | 'layers';

interface FullData {
  events: StoreEntry[];
  machines: Record<string, MachineSnapshot>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DevToolsPanelProps {
  dataSource: DevToolsDataSource;
}

export function DevToolsPanel({ dataSource }: DevToolsPanelProps): React.ReactElement | null {
  const [activeTab, setActiveTab] = useState<Tab>('machines');
  const prevStatusRef = useRef<DevToolsStatus | null>(null);

  // Inject keyframe animation for pulsing record dot (once)
  useEffect(() => {
    const styleId = 'os-devtools-keyframes';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `@keyframes os-dt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`;
    document.head.appendChild(style);
  }, []);

  // Subscribe to store changes via useSyncExternalStore (zero polling).
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return dataSource.subscribe(onStoreChange);
    },
    [dataSource],
  );

  const status = useSyncExternalStore(subscribe, () => {
    const next = dataSource.getStatus();
    if (!next) return null;
    // Structural equality -- only return a new reference when values changed.
    if (
      prevStatusRef.current &&
      prevStatusRef.current.recording === next.recording &&
      prevStatusRef.current.eventCount === next.eventCount &&
      prevStatusRef.current.slowCount === next.slowCount &&
      prevStatusRef.current.machines.length === next.machines.length
    ) {
      return prevStatusRef.current;
    }
    prevStatusRef.current = next;
    return next;
  });

  // Always compute fullData (standalone mode is always expanded)
  const fullData = useSyncExternalStore(subscribe, () => {
    return dataSource.toJSON() as FullData | null;
  });

  const recording = status?.recording ?? false;

  // Record toggle
  const handleRecord = useCallback(() => {
    if (!status) return;
    if (status.recording) {
      dataSource.disable();
    } else {
      dataSource.enable();
    }
  }, [dataSource, status]);

  // Export
  const handleExport = useCallback(() => {
    const data = dataSource.toJSON();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devtools-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [dataSource]);

  // Clear
  const handleClear = useCallback(() => {
    dataSource.clear();
  }, [dataSource]);

  // Derive machine activity colors
  const getMachineActivityColor = (lastTransitionAt: number, eventCount: number): string => {
    const age = Date.now() - lastTransitionAt;
    if (age > 30_000 && eventCount > 0) return '#e06c75'; // stuck
    if (age > 5_000) return '#e5c07b'; // stale
    return '#98c379'; // active
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderMachinesTab = () => {
    if (!fullData) return <div style={{ color: '#666' }}>No data</div>;
    const machines = Object.values(fullData.machines);
    if (machines.length === 0) return <div style={{ color: '#666' }}>No machines tracked</div>;

    return (
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Machine</th>
            <th style={styles.th}>State</th>
            <th style={styles.th}>Events</th>
            <th style={styles.th}>Last Activity</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            const color = getMachineActivityColor(m.lastTransitionAt, m.eventCount);
            return (
              <tr key={m.actorId}>
                <td style={styles.td}>
                  <span style={styles.stateIndicator(color)} />
                  {truncate(m.actorId, 28)}
                </td>
                <td style={styles.td}>{truncate(m.currentState, 20)}</td>
                <td style={styles.td}>{m.eventCount}</td>
                <td style={styles.td}>
                  {m.lastTransitionAt > 0 ? formatTimeAgo(m.lastTransitionAt) : '\u2014'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const renderSlowOpsTab = () => {
    if (!fullData) return <div style={{ color: '#666' }}>No data</div>;
    const slowEntries = fullData.events.filter((entry) => {
      const dur = getEventDuration(entry.event);
      return dur !== null && dur >= SLOW_THRESHOLD;
    });
    slowEntries.sort((a, b) => {
      const da = getEventDuration(a.event) ?? 0;
      const db = getEventDuration(b.event) ?? 0;
      return db - da;
    });
    const capped = slowEntries.slice(0, 100);

    if (capped.length === 0) {
      return <div style={{ color: '#666' }}>No operations above {SLOW_THRESHOLD}ms</div>;
    }

    return (
      <div>
        {capped.map((entry) => {
          const evt = entry.event;
          const dur = getEventDuration(evt)!;
          return (
            <div key={entry.id} style={styles.eventRow}>
              <span style={styles.badge(getTypeBadgeColor(evt.type))}>{evt.type}</span>
              <span style={styles.eventDetail}>{truncate(getEventName(evt), 50)}</span>
              <span style={styles.slowDuration as React.CSSProperties}>{formatDuration(dur)}</span>
              <span style={styles.eventTimestamp}>{formatTimeAgo(evt.timestamp)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderEventsTab = () => {
    if (!fullData) return <div style={{ color: '#666' }}>No data</div>;
    const recent = fullData.events.slice(-50).reverse();
    if (recent.length === 0) return <div style={{ color: '#666' }}>No events recorded</div>;

    return (
      <div>
        {recent.map((entry) => {
          const evt = entry.event;
          return (
            <div key={entry.id} style={styles.eventRow}>
              <span style={styles.badge(getTypeBadgeColor(evt.type))}>{evt.type}</span>
              <span style={styles.eventDetail}>{truncate(getEventName(evt), 55)}</span>
              <span style={styles.eventTimestamp}>{formatTimeAgo(evt.timestamp)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        {/* Record / Stop */}
        <button
          style={styles.recordButton(recording)}
          onClick={handleRecord}
          title={recording ? 'Stop recording' : 'Start recording'}
        >
          {recording ? (
            <>
              <span style={styles.recordIcon} />
              Stop
            </>
          ) : (
            <>
              <span style={styles.stopIcon} />
              Record
            </>
          )}
        </button>

        {/* Event count */}
        <span style={styles.eventCount}>{status ? `${status.eventCount} events` : '\u2014'}</span>

        {/* Export */}
        <button style={styles.button} onClick={handleExport} title="Export trace as JSON">
          Export
        </button>

        {/* Clear */}
        <button style={styles.button} onClick={handleClear} title="Clear all events">
          Clear
        </button>
      </div>

      {/* Panel content */}
      <div style={styles.panel}>
        <div style={{ ...styles.tabBar, flexWrap: 'wrap' }}>
          {(
            [
              ['machines', `Machines${status ? ` (${status.machines.length})` : ''}`],
              ['slowops', `Slow${status ? ` (${status.slowCount})` : ''}`],
              ['events', 'Events'],
              ['viewport', 'VP'],
              ['cells', 'Cell'],
              ['scenegraph', 'Scene'],
              ['layers', 'Layers'],
            ] as [Tab, string][]
          ).map(([tab, label]) => (
            <button
              key={tab}
              style={styles.tab(activeTab === tab)}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={styles.tabContent}>
          {activeTab === 'machines' && renderMachinesTab()}
          {activeTab === 'slowops' && renderSlowOpsTab()}
          {activeTab === 'events' && renderEventsTab()}
          {activeTab === 'viewport' && <ViewportTab dataSource={dataSource} />}
          {activeTab === 'cells' && <CellTab dataSource={dataSource} />}
          {activeTab === 'scenegraph' && <SceneGraphTab dataSource={dataSource} />}
          {activeTab === 'layers' && <LayersTab dataSource={dataSource} />}
        </div>
      </div>
    </div>
  );
}
