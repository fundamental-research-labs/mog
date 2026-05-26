/**
 * MogSdkEventFacade
 *
 * Maps internal SpreadsheetEvent types to stable MogSdkEvent envelope types.
 * Subscribes to the raw IEventBus and exposes only the public SDK event
 * subscription API defined by IMogSdkEventFacade.
 *
 * Internal events with no public mapping are silently dropped.
 */

import type { IEventBus, SpreadsheetEvent, SpreadsheetEventType } from '@mog-sdk/contracts/events';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  IMogSdkEventFacade,
  MogSdkSubscription,
  MogSdkEvent,
  MogSdkEventType,
  MogSdkEventOrigin,
  MogSdkEventScope,
  TypedMogSdkEvent,
} from '@mog-sdk/contracts/sdk';

// ---------------------------------------------------------------------------
// Internal-to-SDK event mapping
// ---------------------------------------------------------------------------

/**
 * Maps internal event type strings to their corresponding stable SDK event
 * type strings. Many-to-one mappings are intentional (e.g. three
 * security:policy-* events all collapse to 'security.policyChanged').
 */
const INTERNAL_TO_SDK_EVENT_MAP: Readonly<Record<string, MogSdkEventType>> = {
  // Data
  'cell:changed': 'cell.changed',
  'cells:batch-changed': 'cells.batchChanged',

  // Sheet lifecycle
  'sheet:created': 'sheet.added',
  'sheet:deleted': 'sheet.removed',
  'sheet:moved': 'sheet.moved',
  'sheet:renamed': 'sheet.renamed',
  'sheet:visibilityChanged': 'sheet.visibilityChanged',
  'sheet:activated': 'sheet.activated',

  // Recalculation
  'recalc:started': 'recalc.started',
  'recalc:completed': 'recalc.completed',

  // Table
  'table:created': 'table.created',
  'table:updated': 'table.updated',
  'table:deleted': 'table.deleted',
  'table:resized': 'table.resized',

  // Named ranges
  'name:created': 'name.created',
  'name:updated': 'name.updated',
  'name:deleted': 'name.deleted',

  // Chart
  'chart:created': 'chart.created',
  'chart:updated': 'chart.updated',
  'chart:deleted': 'chart.deleted',

  // Filter
  'filter:applied': 'filter.applied',
  'filter:cleared': 'filter.cleared',

  // Validation
  'validation:failed': 'validation.failed',
  'validation:passed': 'validation.passed',

  // Security (many-to-one)
  'security:policy-added': 'security.policyChanged',
  'security:policy-removed': 'security.policyChanged',
  'security:policy-updated': 'security.policyChanged',
  'security:access-denied': 'security.accessDenied',

  // Range (many-to-one)
  'range:created': 'range.changed',
  'range:removed': 'range.changed',
  'range:replaced': 'range.changed',

  // Import/export
  'export:progress': 'export.progress',
  'export:complete': 'export.complete',
  'import:progress': 'import.progress',
  'import:complete': 'import.complete',
};

/**
 * Reverse index: SDK event type -> list of internal event types that produce it.
 * Built once at module load from INTERNAL_TO_SDK_EVENT_MAP.
 */
const SDK_TO_INTERNAL_MAP: ReadonlyMap<MogSdkEventType, readonly SpreadsheetEventType[]> = (() => {
  const map = new Map<MogSdkEventType, SpreadsheetEventType[]>();
  for (const [internal, sdk] of Object.entries(INTERNAL_TO_SDK_EVENT_MAP)) {
    let list = map.get(sdk);
    if (!list) {
      list = [];
      map.set(sdk, list);
    }
    list.push(internal as SpreadsheetEventType);
  }
  return map;
})();

// ---------------------------------------------------------------------------
// Payload extraction
// ---------------------------------------------------------------------------

/**
 * Extract the public payload from an internal event. Strips internal-only
 * fields (source, oldValue, config objects, etc.) and keeps only what the
 * MogSdkEventPayloads contract exposes.
 */
function extractPayload(sdkType: MogSdkEventType, event: SpreadsheetEvent): unknown {
  // Cast through unknown to access arbitrary fields safely across the union.
  const e = event as unknown as Record<string, unknown>;

  switch (sdkType) {
    // Cell
    case 'cell.changed':
      return { sheetId: e.sheetId, row: e.row, col: e.col };
    case 'cells.batchChanged':
      return {
        sheetId: e.sheetId,
        count: Array.isArray(e.changes) ? (e.changes as unknown[]).length : 0,
      };

    // Sheet
    case 'sheet.added':
      return { sheetId: e.sheetId, name: e.name, index: e.index };
    case 'sheet.removed':
      return { sheetId: e.sheetId, name: e.name };
    case 'sheet.moved':
      return { sheetId: e.sheetId, fromIndex: e.fromIndex, toIndex: e.toIndex };
    case 'sheet.renamed':
      return { sheetId: e.sheetId, oldName: e.oldName, newName: e.newName };
    case 'sheet.visibilityChanged':
      return { sheetId: e.sheetId, visible: !(e.hidden as boolean) };
    case 'sheet.activated':
      return { sheetId: e.sheetId };

    // Recalc
    case 'recalc.started':
      return {};
    case 'recalc.completed':
      return { changedCellCount: e.cellCount ?? 0 };

    // Table
    case 'table.created':
    case 'table.updated':
    case 'table.deleted':
    case 'table.resized':
      return { sheetId: e.sheetId, tableName: (e.tableId as string) ?? '' };

    // Named ranges
    case 'name.created':
    case 'name.updated':
    case 'name.deleted': {
      // Internal NamedRangeEvents use DefinedName objects; extract the name string.
      const nameObj = e.name ?? e.oldName ?? e.newName;
      const nameStr =
        typeof nameObj === 'object' && nameObj !== null
          ? ((nameObj as Record<string, unknown>).name ?? '')
          : (nameObj ?? '');
      return { name: nameStr };
    }

    // Chart
    case 'chart.created':
    case 'chart.updated':
    case 'chart.deleted':
      return { sheetId: e.sheetId, chartId: e.chartId };

    // Filter
    case 'filter.applied':
    case 'filter.cleared':
      return { sheetId: e.sheetId };

    // Validation
    case 'validation.failed':
    case 'validation.passed':
      return {
        sheetId: e.sheetId,
        address: `R${e.row}C${e.col}`,
      };

    // Security
    case 'security.policyChanged': {
      const policyId = (e.policy as Record<string, unknown>)?.id ?? e.policyId ?? '';
      return { policyId };
    }
    case 'security.accessDenied':
      return {
        operation: e.operation ?? '',
        principal: Array.isArray(e.principalTags)
          ? (e.principalTags as string[]).join(',')
          : undefined,
      };

    // Range
    case 'range.changed':
      return { sheetId: e.sheetId, range: e.rangeId ?? '' };

    // Import/export
    case 'export.progress':
      return { phase: e.phase ?? '', percentage: (e.progress as number) ?? 0 };
    case 'export.complete':
      return { byteSize: (e.fileSizeBytes as number) ?? 0 };
    case 'import.progress':
      return { phase: e.phase ?? '', percentage: (e.progress as number) ?? 0 };
    case 'import.complete':
      return { sheetCount: e.sheetCount ?? 0, cellCount: e.cellCount ?? 0 };

    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Origin derivation
// ---------------------------------------------------------------------------

function deriveOrigin(event: SpreadsheetEvent): MogSdkEventOrigin {
  const source = (event as unknown as Record<string, unknown>).source;
  if (source === 'remote') return 'remote';
  if (source === 'system') return 'system';
  return 'local';
}

// ---------------------------------------------------------------------------
// Scope derivation
// ---------------------------------------------------------------------------

function deriveScope(event: SpreadsheetEvent): MogSdkEventScope {
  const e = event as unknown as Record<string, unknown>;
  if (typeof e.sheetId === 'string') {
    return { kind: 'sheet', sheetId: toSheetId(e.sheetId) };
  }
  return { kind: 'document' };
}

// ---------------------------------------------------------------------------
// MogSdkEventFacade implementation
// ---------------------------------------------------------------------------

export class MogSdkEventFacade implements IMogSdkEventFacade {
  private readonly eventBus: IEventBus;
  private readonly documentId: string;
  private sequence = 0;

  constructor(eventBus: IEventBus, documentId: string) {
    this.eventBus = eventBus;
    this.documentId = documentId;
  }

  // -----------------------------------------------------------------------
  // Envelope factory
  // -----------------------------------------------------------------------

  private wrap(sdkType: MogSdkEventType, internal: SpreadsheetEvent): MogSdkEvent {
    return {
      type: sdkType,
      version: 1,
      documentId: this.documentId,
      origin: deriveOrigin(internal),
      sequence: ++this.sequence,
      timestamp: Date.now(),
      scope: deriveScope(internal),
      payload: extractPayload(sdkType, internal),
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  on<K extends MogSdkEventType>(
    type: K,
    handler: (event: TypedMogSdkEvent<K>) => void,
  ): MogSdkSubscription {
    const internalTypes = SDK_TO_INTERNAL_MAP.get(type);
    if (!internalTypes || internalTypes.length === 0) {
      // No internal events map to this SDK type — return a no-op subscription.
      return { dispose() {} };
    }

    const unsubscribers: Array<() => void> = [];

    for (const internalType of internalTypes) {
      const unsub = this.eventBus.on(internalType, (event: SpreadsheetEvent) => {
        const envelope = this.wrap(type, event) as TypedMogSdkEvent<K>;
        handler(envelope);
      });
      unsubscribers.push(unsub);
    }

    return {
      dispose() {
        for (const unsub of unsubscribers) unsub();
      },
    };
  }

  onMany(
    types: readonly MogSdkEventType[],
    handler: (event: MogSdkEvent) => void,
  ): MogSdkSubscription {
    const subscriptions = types.map((type) => this.on(type, handler));

    return {
      dispose() {
        for (const sub of subscriptions) sub.dispose();
      },
    };
  }

  onAll(handler: (event: MogSdkEvent) => void): MogSdkSubscription {
    const unsub = this.eventBus.onAll((event: SpreadsheetEvent) => {
      const sdkType = INTERNAL_TO_SDK_EVENT_MAP[event.type];
      if (sdkType === undefined) return; // Silently drop unmapped events.
      const envelope = this.wrap(sdkType, event);
      handler(envelope);
    });

    return { dispose: unsub };
  }

  once<K extends MogSdkEventType>(type: K): Promise<TypedMogSdkEvent<K>> {
    return new Promise<TypedMogSdkEvent<K>>((resolve, reject) => {
      const subscription = this.on(type, (event) => {
        subscription.dispose();
        resolve(event);
      });

      // If there are no internal types for this SDK type the promise will
      // never resolve naturally. We don't reject eagerly here because the
      // caller may be listening for a future event type that gains mappings
      // later.
    });
  }
}
