import type { ActorEvent, MachineSnapshot, RuntimeEvent, StoreEntry } from '../types';

// Console styling
const STYLES = {
  header: 'font-weight: bold; font-size: 12px;',
  dim: 'color: #888;',
  actor: 'color: #61afef; font-weight: bold;',
  eventbus: 'color: #98c379; font-weight: bold;',
  render: 'color: #e5c07b; font-weight: bold;',
  canvas: 'color: #c678dd; font-weight: bold;',
  bridge: 'color: #e06c75; font-weight: bold;',
  'viewport-buffer': 'color: #d19a66; font-weight: bold;',
  action: 'color: #ff79c6; font-weight: bold;',
  receipt: 'color: #8be9fd; font-weight: bold;',
  scenegraph: 'color: #50fa7b; font-weight: bold;',
  state: 'color: #56b6c2;',
  warning: 'color: #e5c07b;',
  error: 'color: #e06c75; font-weight: bold;',
  success: 'color: #98c379;',
} as const;

export function printMachines(machines: Map<string, MachineSnapshot>): void {
  if (machines.size === 0) {
    console.log('%c  No live machines', STYLES.dim);
    return;
  }

  console.log(
    '%c  MACHINE                  STATE              EVENTS  LAST TRANSITION',
    STYLES.header,
  );
  console.log('%c  ' + '\u2500'.repeat(70), STYLES.dim);

  for (const [, m] of machines) {
    const ago = formatAgo(m.lastTransitionAt);
    const name = m.actorId.padEnd(24);
    const state = m.currentState.padEnd(18);
    const events = String(m.eventCount).padEnd(7);

    console.log(
      `%c  ${name} %c${state} %c${events} %c${ago}`,
      STYLES.actor,
      STYLES.state,
      STYLES.dim,
      STYLES.dim,
    );
  }
}

export function printMachine(machine: MachineSnapshot | undefined, id: string): void {
  if (!machine) {
    console.log(`%c  Machine "${id}" not found`, STYLES.error);
    return;
  }

  console.log(`%c  Machine: %c${machine.actorId}`, STYLES.dim, STYLES.actor);
  console.log(`%c  State:   %c${machine.currentState}`, STYLES.dim, STYLES.state);

  if (machine.context) {
    console.log(`%c  Context:`, STYLES.dim, machine.context);
  }

  const transitions = machine.transitions.slice(-10);
  if (transitions.length > 0) {
    console.log('');
    console.log(`%c  Last ${transitions.length} transitions:`, STYLES.header);

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];
      const ago = formatAgo(t.timestamp);
      const arrow = t.fromState === t.toState ? '\u2192 (self)' : `\u2192 ${t.toState}`;
      const eventLabel = t.eventType ?? '';

      console.log(
        `%c  #${i + 1}  %c${eventLabel.padEnd(18)} %c${t.fromState} ${arrow}  %c${ago}`,
        STYLES.dim,
        STYLES.actor,
        STYLES.state,
        STYLES.dim,
      );
    }
  }
}

export function printTransitions(transitions: ActorEvent[], filter?: string): void {
  const filtered = filter ? transitions.filter((t) => t.actorId.includes(filter)) : transitions;

  if (filtered.length === 0) {
    console.log('%c  No transitions found', STYLES.dim);
    return;
  }

  for (const t of filtered.slice(-20)) {
    const ago = formatAgo(t.timestamp);
    const arrow = t.kind === 'transition' ? `${t.fromState} \u2192 ${t.toState}` : t.kind;

    console.log(
      `%c  ${ago.padEnd(10)} %c${t.actorId.padEnd(20)} %c${t.eventType?.padEnd(18) ?? ''} %c${arrow}`,
      STYLES.dim,
      STYLES.actor,
      STYLES.eventbus,
      STYLES.state,
    );
  }
}

export function printEntries(entries: StoreEntry[]): void {
  for (const entry of entries) {
    printEvent(entry.event);
  }
}

export function printEvent(event: RuntimeEvent): void {
  const ago = formatAgo(event.timestamp);

  switch (event.type) {
    case 'actor': {
      const arrow =
        event.kind === 'transition' ? `${event.fromState} \u2192 ${event.toState}` : event.kind;
      console.log(
        `%c  ${ago.padEnd(10)} %cXSTATE   %c${event.actorId}: ${arrow}  (${event.eventType})`,
        STYLES.dim,
        STYLES.actor,
        STYLES.state,
      );
      break;
    }
    case 'eventbus':
      console.log(
        `%c  ${ago.padEnd(10)} %cEVENTBUS %c${event.eventType}`,
        STYLES.dim,
        STYLES.eventbus,
        STYLES.state,
      );
      break;
    case 'render':
      console.log(
        `%c  ${ago.padEnd(10)} %cREACT    %c${event.appId}/${event.componentId} ${event.phase} ${event.actualDurationMs.toFixed(1)}ms`,
        STYLES.dim,
        STYLES.render,
        STYLES.state,
      );
      break;
    case 'canvas': {
      const layers = Object.entries(event.layerTimings)
        .map(([name, t]) => `${name}: ${t.lastMs.toFixed(1)}ms`)
        .join(', ');
      console.log(
        `%c  ${ago.padEnd(10)} %cCANVAS   %cframe [${layers}] total: ${event.totalMs.toFixed(1)}ms`,
        STYLES.dim,
        STYLES.canvas,
        STYLES.state,
      );
      break;
    }
    case 'bridge': {
      let meta = '';
      if (event.mutationMeta) {
        const m = event.mutationMeta;
        const kb = (m.viewportPatchBytes / 1024).toFixed(1);
        meta = ` [patches: ${kb}KB, ${m.changedCellCount} changed, ${m.recalcedCellCount} recalc]`;
      }
      console.log(
        `%c  ${ago.padEnd(10)} %cBRIDGE   %c${event.bridgeName}.${event.method}() ${event.durationMs.toFixed(1)}ms${meta}${event.error ? ' ERROR: ' + event.error : ''}`,
        STYLES.dim,
        STYLES.bridge,
        STYLES.state,
      );
      break;
    }
    case 'viewport-buffer': {
      const bounds = `[${event.bufferBounds.startRow},${event.bufferBounds.startCol}]-[${event.bufferBounds.startRow + event.bufferBounds.rows},${event.bufferBounds.startCol + event.bufferBounds.cols}]`;
      const samples = event.sampleCells?.length
        ? ` samples: ${event.sampleCells.map((c) => `(${c.row},${c.col})=${c.displayText ?? 'null'}`).join(', ')}`
        : '';
      console.log(
        `%c  ${ago.padEnd(10)} %cVIEWPORT %c${event.kind} ${event.patchCount} cells, ${event.skippedOutOfBounds} skipped, gen=${event.generation} ${bounds}${samples}`,
        STYLES.dim,
        STYLES['viewport-buffer'],
        STYLES.state,
      );
      break;
    }
    case 'action': {
      const status = event.handled ? '\u2713' : '\u2717';
      const statusStyle = event.handled ? STYLES.success : STYLES.error;
      const receipts = event.receiptCount > 0 ? `, ${event.receiptCount} receipt(s)` : '';
      const err = event.error ? ` ERROR: ${event.error}` : '';
      console.log(
        `%c  ${ago.padEnd(10)} %cACTION   %c${event.action} ${event.durationMs.toFixed(1)}ms${receipts}${err} %c${status}`,
        STYLES.dim,
        STYLES.action,
        STYLES.state,
        statusStyle,
      );
      break;
    }
    case 'receipt': {
      const items = event.receipts
        .map(
          (r) =>
            `${r.domain}:${r.action} ${r.id.slice(0, 12)}${r.hasBounds ? '' : ' NO-BOUNDS'}${r.hasObject ? '' : ' NO-DATA'}`,
        )
        .join(', ');
      console.log(
        `%c  ${ago.padEnd(10)} %cRECEIPT  %c${event.receipts.length} receipt(s): ${items}`,
        STYLES.dim,
        STYLES.receipt,
        STYLES.state,
      );
      break;
    }
    case 'scenegraph': {
      const items = event.patches
        .map((p) => {
          if (p.skipped) return `${p.objectId.slice(0, 12)} SKIPPED(${p.skipReason})`;
          return `${p.kind} ${p.objectType ?? '?'} ${p.objectId.slice(0, 12)}`;
        })
        .join(', ');
      console.log(
        `%c  ${ago.padEnd(10)} %cSCENE    %c${event.patches.length} patch(es): ${items}`,
        STYLES.dim,
        STYLES.scenegraph,
        STYLES.state,
      );
      break;
    }
  }
}

export function printSlow(entries: StoreEntry[], thresholdMs: number): void {
  const slow = entries.filter((e) => {
    const evt = e.event;
    switch (evt.type) {
      case 'render':
        return evt.actualDurationMs >= thresholdMs;
      case 'canvas':
        return evt.totalMs >= thresholdMs;
      case 'bridge':
        return evt.durationMs >= thresholdMs;
      case 'action':
        return evt.durationMs >= thresholdMs;
      default:
        return false;
    }
  });

  if (slow.length === 0) {
    console.log(`%c  No events above ${thresholdMs}ms threshold`, STYLES.dim);
    return;
  }

  console.log(`%c  ${slow.length} slow events (>${thresholdMs}ms):`, STYLES.warning);
  printEntries(slow);
}

export function printBufferEvents(entries: StoreEntry[], filter?: string): void {
  const filtered = entries.filter((e) => {
    if (e.event.type !== 'viewport-buffer') return false;
    if (filter) {
      return e.event.viewportId.includes(filter) || e.event.kind.includes(filter);
    }
    return true;
  });

  if (filtered.length === 0) {
    console.log('%c  No viewport buffer events', STYLES.dim);
    return;
  }

  printEntries(filtered);
}

export function printMutations(entries: StoreEntry[]): void {
  // Find all mutation bridge calls and pair them with subsequent viewport-buffer events
  const allEvents = entries.map((e) => e.event);

  const mutations: Array<{
    bridge: import('../types').BridgeCallEvent;
    bufferEvents: import('../types').ViewportBufferEvent[];
  }> = [];

  for (let i = 0; i < allEvents.length; i++) {
    const evt = allEvents[i];
    if (evt.type === 'bridge' && evt.mutationMeta) {
      const bufferEvents: import('../types').ViewportBufferEvent[] = [];
      // Look ahead for viewport-buffer events within 100ms
      for (let j = i + 1; j < allEvents.length; j++) {
        const next = allEvents[j];
        if (next.timestamp - evt.timestamp > 100) break;
        if (next.type === 'viewport-buffer' && next.kind === 'mutation-applied') {
          bufferEvents.push(next);
        }
      }
      mutations.push({ bridge: evt, bufferEvents });
    }
  }

  if (mutations.length === 0) {
    console.log('%c  No mutation bridge calls found', STYLES.dim);
    return;
  }

  console.log('%c  MUTATIONS', STYLES.header);
  console.log('%c  ' + '\u2500'.repeat(70), STYLES.dim);

  for (const { bridge, bufferEvents } of mutations) {
    const ago = formatAgo(bridge.timestamp);
    const m = bridge.mutationMeta!;
    const kb = (m.viewportPatchBytes / 1024).toFixed(1);
    const outcome =
      bufferEvents.length > 0
        ? bufferEvents.map((e) => `${e.patchCount} cell(s) patched (${e.viewportId})`).join(', ')
        : 'NO VIEWPORT UPDATE';
    const icon = bufferEvents.length > 0 && m.viewportPatchBytes > 0 ? '\u2713' : '\u2717';
    const iconStyle =
      bufferEvents.length > 0 && m.viewportPatchBytes > 0 ? STYLES.success : STYLES.error;

    console.log(
      `%c  ${ago.padEnd(10)} %c${bridge.bridgeName}.${bridge.method}()  ${bridge.durationMs.toFixed(0)}ms  patches=${kb}KB  %c\u2192 ${outcome}  %c${icon}`,
      STYLES.dim,
      STYLES.bridge,
      STYLES.state,
      iconStyle,
    );
  }
}

export function printCellHistory(entries: StoreEntry[], row: number, col: number): void {
  const mutations: Array<{
    timestamp: number;
    source: string;
    displayText: string | null;
  }> = [];

  for (const entry of entries) {
    const evt = entry.event;
    if (evt.type === 'viewport-buffer' && evt.sampleCells) {
      for (const cell of evt.sampleCells) {
        if (cell.row === row && cell.col === col) {
          mutations.push({
            timestamp: evt.timestamp,
            source: `${evt.kind} (${evt.viewportId})`,
            displayText: cell.displayText,
          });
        }
      }
    }
  }

  if (mutations.length === 0) {
    console.log(`%c  No mutations found for cell (${row}, ${col}) in sample data`, STYLES.dim);
    console.log('%c  Note: only cells in the first 5 patches per mutation are sampled', STYLES.dim);
    return;
  }

  console.log(`%c  CELL HISTORY (${row}, ${col})`, STYLES.header);
  console.log('%c  ' + '\u2500'.repeat(50), STYLES.dim);

  for (const m of mutations) {
    const ago = formatAgo(m.timestamp);
    console.log(
      `%c  ${ago.padEnd(10)} %c${m.source.padEnd(30)} %c"${m.displayText ?? 'null'}"`,
      STYLES.dim,
      STYLES['viewport-buffer'],
      STYLES.state,
    );
  }
}

export function printFlow(entries: StoreEntry[], correlationId: number): void {
  if (entries.length === 0) {
    console.log(`%c  No events for flow #${correlationId}`, STYLES.dim);
    return;
  }

  // Sort by timestamp ascending
  const sorted = [...entries].sort((a, b) => a.event.timestamp - b.event.timestamp);
  const baseTime = sorted[0].event.timestamp;

  // Determine flow description from first and last events
  const first = sorted[0].event;
  const last = sorted[sorted.length - 1].event;
  const firstLabel =
    first.type === 'actor'
      ? `${first.actorId} ${first.eventType}`
      : first.type === 'bridge'
        ? `${first.bridgeName}.${first.method}()`
        : first.type;
  const lastLabel =
    last.type === 'canvas'
      ? 'canvas repaint'
      : last.type === 'viewport-buffer'
        ? `viewport ${last.kind}`
        : last.type;

  console.log(`%c  Flow #${correlationId} (${firstLabel} \u2192 ${lastLabel})`, STYLES.header);

  for (const entry of sorted) {
    const evt = entry.event;
    const offset = (evt.timestamp - baseTime).toFixed(1);
    const prefix = `T+${offset}ms`.padEnd(12);

    let runtime = '';
    let detail = '';

    switch (evt.type) {
      case 'actor':
        runtime = 'actor    ';
        detail = `${evt.actorId}: ${evt.fromState} \u2192 ${evt.toState}  (${evt.eventType})`;
        break;
      case 'bridge': {
        runtime = 'bridge   ';
        let meta = '';
        if (evt.mutationMeta) {
          const kb = (evt.mutationMeta.viewportPatchBytes / 1024).toFixed(1);
          meta = `  [patches: ${kb}KB, ${evt.mutationMeta.changedCellCount} cell(s)]`;
        }
        detail = `${evt.bridgeName}.${evt.method}() ${evt.durationMs.toFixed(0)}ms${meta}`;
        break;
      }
      case 'viewport-buffer':
        runtime = 'viewport ';
        detail = `${evt.kind}: ${evt.patchCount} cell(s) patched  [${evt.viewportId}, gen=${evt.generation}]`;
        break;
      case 'eventbus':
        runtime = 'eventbus ';
        detail = evt.eventType;
        break;
      case 'canvas':
        runtime = 'canvas   ';
        detail = `frame ${evt.totalMs.toFixed(1)}ms`;
        break;
      case 'render':
        runtime = 'react    ';
        detail = `${evt.appId}/${evt.componentId} ${evt.phase} ${evt.actualDurationMs.toFixed(1)}ms`;
        break;
      case 'action':
        runtime = 'action   ';
        detail = `${evt.action} ${evt.durationMs.toFixed(1)}ms ${evt.handled ? '\u2713' : '\u2717'}${evt.receiptCount > 0 ? ` (${evt.receiptCount} receipts)` : ''}${evt.error ? ' ERROR: ' + evt.error : ''}`;
        break;
      case 'receipt':
        runtime = 'receipt  ';
        detail = evt.receipts.map((r) => `${r.domain}:${r.action} ${r.id.slice(0, 12)}`).join(', ');
        break;
      case 'scenegraph':
        runtime = 'scene    ';
        detail = evt.patches
          .map((p) => (p.skipped ? `SKIP(${p.skipReason})` : `${p.kind} ${p.objectType ?? '?'}`))
          .join(', ');
        break;
    }

    console.log(
      `%c    ${prefix} %c${runtime} %c${detail}`,
      STYLES.dim,
      STYLES[evt.type as keyof typeof STYLES] ?? STYLES.dim,
      STYLES.state,
    );
  }
}

function formatAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return `${diff}ms ago`;
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s ago`;
  return `${(diff / 60000).toFixed(1)}m ago`;
}
