/**
 * SDK Events Conformance Tests
 *
 * Validates that the public MogSdkEventFacade contract (doc.events) works
 * correctly for SDK consumers using ONLY public SDK entrypoints.
 *
 * Import rules:
 * - OK: MogDocumentFactory, types from @mog-sdk/contracts/sdk
 * - FORBIDDEN: IEventBus, MogSdkEventFacade (impl), or any internal path
 */

// Runtime imports
import { MogDocumentFactory } from '../../mog-document-factory';

// Contract types
import type { MogDocument } from '@mog-sdk/contracts/sdk';
import type {
  MogSdkEvent,
  MogSdkEventType,
  IMogSdkEventFacade,
  MogSdkSubscription,
  TypedMogSdkEvent,
} from '@mog-sdk/contracts/sdk';
import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestDocument(): Promise<MogDocument> {
  return MogDocumentFactory.create({
    runtime: { kind: 'headless', userTimezone: 'UTC' },
  });
}

// ---------------------------------------------------------------------------
// 1. Event facade access
// ---------------------------------------------------------------------------

describe('doc.events facade access', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('returns an object with on, onMany, onAll, once methods', async () => {
    doc = await createTestDocument();
    const events: IMogSdkEventFacade = doc.events;

    expect(events).toBeDefined();
    expect(typeof events.on).toBe('function');
    expect(typeof events.onMany).toBe('function');
    expect(typeof events.onAll).toBe('function');
    expect(typeof events.once).toBe('function');
  });

  it('is referentially stable across repeated access', async () => {
    doc = await createTestDocument();
    const events1 = doc.events;
    const events2 = doc.events;
    expect(events1).toBe(events2);
  });
});

// ---------------------------------------------------------------------------
// 2. Subscription lifecycle
// ---------------------------------------------------------------------------

describe('subscription lifecycle', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('on() returns a MogSdkSubscription with dispose()', async () => {
    doc = await createTestDocument();
    const sub: MogSdkSubscription = doc.events.on('cell.changed', () => {});
    expect(sub).toBeDefined();
    expect(typeof sub.dispose).toBe('function');
    sub.dispose();
  });

  it('handler is not called after dispose()', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws: Worksheet = wb.activeSheet;

    const calls: MogSdkEvent[] = [];
    const sub = doc.events.on('cell.changed', (event) => {
      calls.push(event);
    });

    // Trigger once before dispose
    await ws.setCell('A1', 1);
    // Allow async event delivery
    await new Promise((r) => setTimeout(r, 200));

    const countBefore = calls.length;
    sub.dispose();

    // Trigger again after dispose
    await ws.setCell('A2', 2);
    await new Promise((r) => setTimeout(r, 200));

    expect(calls.length).toBe(countBefore);
  });

  it('multiple subscriptions to the same event type are independent', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws: Worksheet = wb.activeSheet;

    const calls1: MogSdkEvent[] = [];
    const calls2: MogSdkEvent[] = [];

    const sub1 = doc.events.on('cell.changed', (e) => calls1.push(e));
    const sub2 = doc.events.on('cell.changed', (e) => calls2.push(e));

    await ws.setCell('A1', 42);
    await new Promise((r) => setTimeout(r, 200));

    // Both handlers should have been called
    expect(calls1.length).toBeGreaterThan(0);
    expect(calls2.length).toBeGreaterThan(0);

    // Dispose one; the other should still work
    sub1.dispose();

    await ws.setCell('A2', 99);
    await new Promise((r) => setTimeout(r, 200));

    const count1After = calls1.length;
    const count2After = calls2.length;

    await ws.setCell('A3', 100);
    await new Promise((r) => setTimeout(r, 200));

    // sub1 should not have received new events
    expect(calls1.length).toBe(count1After);
    // sub2 should have received more
    expect(calls2.length).toBeGreaterThan(count2After);

    sub2.dispose();
  });
});

// ---------------------------------------------------------------------------
// 3. Event envelope structure
// ---------------------------------------------------------------------------

describe('event envelope structure', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('cell.changed event has the correct envelope fields', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws: Worksheet = wb.activeSheet;

    const received: MogSdkEvent[] = [];
    doc.events.on('cell.changed', (event) => {
      received.push(event);
    });

    await ws.setCell('A1', 42);
    await new Promise((r) => setTimeout(r, 200));

    expect(received.length).toBeGreaterThan(0);
    const event = received[0];

    // Envelope fields
    expect(event.type).toBe('cell.changed');
    expect(event.version).toBe(1);
    expect(typeof event.documentId).toBe('string');
    expect(event.documentId).toBe(doc.documentId);
    expect(event.origin).toBe('local');
    expect(typeof event.sequence).toBe('number');
    expect(typeof event.timestamp).toBe('number');

    // Scope
    expect(event.scope).toBeDefined();
    expect(event.scope.kind).toBe('sheet');

    // Payload
    expect(event.payload).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Sheet lifecycle events
// ---------------------------------------------------------------------------

describe('sheet lifecycle events', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('sheet.added fires when a sheet is added', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();

    const received: MogSdkEvent[] = [];
    doc.events.on('sheet.added', (event) => {
      received.push(event);
    });

    await wb.sheets.add('TestSheet');
    await new Promise((r) => setTimeout(r, 200));

    expect(received.length).toBeGreaterThan(0);
    const event = received[0];
    expect(event.type).toBe('sheet.added');

    const payload = event.payload as { sheetId?: string; name?: string };
    expect(typeof payload.sheetId).toBe('string');
    expect(payload.name).toBe('TestSheet');
  });
});

// ---------------------------------------------------------------------------
// 5. onMany subscription
// ---------------------------------------------------------------------------

describe('onMany subscription', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('receives events for all subscribed types', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws: Worksheet = wb.activeSheet;

    const received: MogSdkEvent[] = [];
    const sub = doc.events.onMany(['cell.changed', 'sheet.added'], (event) => {
      received.push(event);
    });

    // Trigger a cell change
    await ws.setCell('A1', 42);
    await new Promise((r) => setTimeout(r, 200));

    // Trigger a sheet add
    await wb.sheets.add('Extra');
    await new Promise((r) => setTimeout(r, 200));

    const types = received.map((e) => e.type);
    expect(types).toContain('cell.changed');
    expect(types).toContain('sheet.added');

    sub.dispose();
  });
});

// ---------------------------------------------------------------------------
// 6. onAll subscription
// ---------------------------------------------------------------------------

describe('onAll subscription', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('receives mapped events for mutations', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws: Worksheet = wb.activeSheet;

    const received: MogSdkEvent[] = [];
    const sub = doc.events.onAll((event) => {
      received.push(event);
    });

    await ws.setCell('A1', 42);
    await new Promise((r) => setTimeout(r, 200));

    // At least cell.changed should arrive (unmapped internals are silently dropped)
    const types = received.map((e) => e.type);
    expect(types).toContain('cell.changed');

    sub.dispose();
  });
});

// ---------------------------------------------------------------------------
// 7. once() returns a promise
// ---------------------------------------------------------------------------

describe('once() promise API', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('resolves with the first matching event', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws: Worksheet = wb.activeSheet;

    const promise = doc.events.once('cell.changed');

    await ws.setCell('A1', 1);

    const event = await promise;

    expect(event).toBeDefined();
    expect(event.type).toBe('cell.changed');
    expect(event.version).toBe(1);
    expect(typeof event.documentId).toBe('string');
    expect(event.documentId).toBe(doc.documentId);
    expect(typeof event.sequence).toBe('number');
    expect(typeof event.timestamp).toBe('number');
    expect(event.scope).toBeDefined();
    expect(event.payload).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Event sequence ordering
// ---------------------------------------------------------------------------

describe('event sequence ordering', () => {
  let doc: MogDocument;

  afterEach(async () => {
    if (doc && !doc.isDisposed) {
      await doc.close();
    }
  });

  it('sequence numbers are monotonically increasing', async () => {
    doc = await createTestDocument();
    const wb: Workbook = await doc.workbook();
    const ws: Worksheet = wb.activeSheet;

    const received: MogSdkEvent[] = [];
    doc.events.on('cell.changed', (event) => {
      received.push(event);
    });

    await ws.setCell('A1', 1);
    await ws.setCell('A2', 2);
    await ws.setCell('A3', 3);
    await new Promise((r) => setTimeout(r, 200));

    expect(received.length).toBeGreaterThanOrEqual(3);

    for (let i = 1; i < received.length; i++) {
      expect(received[i].sequence).toBeGreaterThan(received[i - 1].sequence);
    }
  });
});
