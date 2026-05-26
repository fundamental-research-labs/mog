import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { DevToolsReceiver } from '../bridge/broadcast-channel';
import { RemoteEventStore } from '../bridge/remote-event-store';
import { DevToolsPanel } from './DevToolsPanel';

export function DevToolsApp(): React.ReactElement {
  const receiverRef = useRef<DevToolsReceiver | null>(null);
  const storeRef = useRef<RemoteEventStore | null>(null);

  // Initialize once
  if (!receiverRef.current) {
    receiverRef.current = new DevToolsReceiver();
    storeRef.current = new RemoteEventStore(receiverRef.current);
  }

  const store = storeRef.current!;

  // Connect on mount
  useEffect(() => {
    store.connect();
    return () => {
      store.dispose();
      receiverRef.current?.dispose();
    };
  }, []);

  // Track connection for title
  const connected = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.isConnected,
  );

  const status = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getStatus(),
  );

  // Update window title
  useEffect(() => {
    const count = status?.eventCount ?? 0;
    const state = connected ? 'Connected' : 'Connecting...';
    document.title = `OS DevTools - ${state} (${count} events)`;
  }, [connected, status?.eventCount]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!connected && (
        <div
          style={{
            padding: '8px 12px',
            background: '#2a2a2a',
            color: '#e5c07b',
            fontSize: 11,
            fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
            borderBottom: '1px solid #444',
          }}
        >
          Connecting to main window...
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DevToolsPanel dataSource={store} />
      </div>
    </div>
  );
}
