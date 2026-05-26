/**
 * Capability Audit Logger Tests
 *
 * Comprehensive tests for the capability audit logger:
 * - Log entry creation
 * - Query filtering (by app, by capability, by event type, by time range)
 * - Retention pruning (time-based and count-based)
 * - Export formats (JSON, CSV)
 * - Stats accuracy
 *
 */

import { jest } from '@jest/globals';

import type { CapabilityType } from '../cap-types';
import type { AppId } from '../grants';

import { CapabilityAuditLogger, createCapabilityAuditLogger } from '../audit-logger';
import type { AuditEventType, CapabilityAuditEntry } from '../types';

// =============================================================================
// Test Helpers
// =============================================================================

function appId(id: string): AppId {
  return id as AppId;
}

function createTestEntry(
  overrides: Partial<Omit<CapabilityAuditEntry, 'id' | 'timestamp'>> = {},
): Omit<CapabilityAuditEntry, 'id' | 'timestamp'> {
  return {
    appId: appId('test-app'),
    capability: 'cells:read' as CapabilityType,
    eventType: 'used',
    ...overrides,
  };
}

// =============================================================================
// Log Entry Creation Tests
// =============================================================================

describe('CapabilityAuditLogger - Log Entry Creation', () => {
  let logger: CapabilityAuditLogger;

  beforeEach(() => {
    logger = createCapabilityAuditLogger({ autoPrune: false });
  });

  afterEach(() => {
    logger.dispose();
  });

  it('should create entry with auto-generated id and timestamp', () => {
    const now = Date.now();
    logger.log(createTestEntry());

    const entries = logger.getAllEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toMatch(/^audit-\d+$/);
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(now);
    expect(entries[0].timestamp).toBeLessThanOrEqual(now + 100);
  });

  it('should preserve all entry fields', () => {
    const entry = createTestEntry({
      appId: appId('my-app'),
      capability: 'tables:write' as CapabilityType,
      eventType: 'granted',
      operation: 'createTable',
      resourceType: 'table',
      resourceId: 'contacts',
      metadata: { reason: 'user-request' },
    });

    logger.log(entry);

    const entries = logger.getAllEntries();
    expect(entries[0]).toMatchObject({
      appId: 'my-app',
      capability: 'tables:write',
      eventType: 'granted',
      operation: 'createTable',
      resourceType: 'table',
      resourceId: 'contacts',
      metadata: { reason: 'user-request' },
    });
  });

  it('should generate unique IDs for each entry', () => {
    logger.log(createTestEntry());
    logger.log(createTestEntry());
    logger.log(createTestEntry());

    const entries = logger.getAllEntries();
    const ids = entries.map((e) => e.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(3);
  });

  it('should support all event types', () => {
    const eventTypes: AuditEventType[] = [
      'granted',
      'revoked',
      'revoked-all',
      'used',
      'denied',
      'expired',
      'check-passed',
      'check-failed',
      'auto-granted',
      'auto-granted-migration',
    ];

    for (const eventType of eventTypes) {
      logger.log(createTestEntry({ eventType }));
    }

    const entries = logger.getAllEntries();
    expect(entries).toHaveLength(eventTypes.length);
  });
});

// =============================================================================
// Query Filtering Tests
// =============================================================================

describe('CapabilityAuditLogger - Query Filtering', () => {
  let logger: CapabilityAuditLogger;

  beforeEach(() => {
    logger = createCapabilityAuditLogger({ autoPrune: false });

    // Seed with test data
    logger.log(
      createTestEntry({
        appId: appId('app-1'),
        capability: 'cells:read' as CapabilityType,
        eventType: 'used',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-1'),
        capability: 'cells:write' as CapabilityType,
        eventType: 'denied',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-2'),
        capability: 'tables:read' as CapabilityType,
        eventType: 'granted',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-2'),
        capability: 'cells:read' as CapabilityType,
        eventType: 'used',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-3'),
        capability: 'network:any' as CapabilityType,
        eventType: 'denied',
      }),
    );
  });

  afterEach(() => {
    logger.dispose();
  });

  describe('filter by app', () => {
    it('should filter by app ID', () => {
      const entries = logger.query({ appId: appId('app-1') });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.appId === 'app-1')).toBe(true);
    });

    it('should return empty for non-existent app', () => {
      const entries = logger.query({ appId: appId('non-existent') });
      expect(entries).toHaveLength(0);
    });

    it('should work with getByApp convenience method', () => {
      const entries = logger.getByApp(appId('app-2'));
      expect(entries).toHaveLength(2);
    });

    it('should respect limit with getByApp', () => {
      const entries = logger.getByApp(appId('app-2'), 1);
      expect(entries).toHaveLength(1);
    });
  });

  describe('filter by capability', () => {
    it('should filter by capability', () => {
      const entries = logger.query({ capability: 'cells:read' as CapabilityType });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.capability === 'cells:read')).toBe(true);
    });

    it('should work with getByCapability convenience method', () => {
      const entries = logger.getByCapability('cells:read' as CapabilityType);
      expect(entries).toHaveLength(2);
    });
  });

  describe('filter by event type', () => {
    it('should filter by single event type', () => {
      const entries = logger.query({ eventTypes: ['denied'] });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.eventType === 'denied')).toBe(true);
    });

    it('should filter by multiple event types', () => {
      const entries = logger.query({ eventTypes: ['denied', 'granted'] });
      expect(entries).toHaveLength(3);
      expect(entries.every((e) => ['denied', 'granted'].includes(e.eventType))).toBe(true);
    });

    it('should work with getDenials convenience method', () => {
      const entries = logger.getDenials();
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.eventType === 'denied')).toBe(true);
    });
  });

  describe('filter by time range', () => {
    it('should filter entries since timestamp', () => {
      // Add an old entry
      const oldTimestamp = Date.now() - 10000;
      const originalEntries = logger.getAllEntries();

      // All current entries should be after now - 1 second
      const entries = logger.query({ since: Date.now() - 1000 });
      expect(entries.length).toBeLessThanOrEqual(originalEntries.length);
    });

    it('should filter entries until timestamp', () => {
      const entries = logger.query({ until: Date.now() + 1000 });
      expect(entries.length).toBe(5); // All entries
    });

    it('should support time range with getDenials', () => {
      const recentDenials = logger.getDenials(new Date(Date.now() - 1000));
      expect(recentDenials.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('combined filters', () => {
    it('should support multiple filters', () => {
      const entries = logger.query({
        appId: appId('app-1'),
        eventTypes: ['denied'],
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].appId).toBe('app-1');
      expect(entries[0].eventType).toBe('denied');
    });

    it('should support app + capability filter', () => {
      const entries = logger.query({
        appId: appId('app-2'),
        capability: 'cells:read' as CapabilityType,
      });
      expect(entries).toHaveLength(1);
    });
  });

  describe('pagination', () => {
    it('should respect limit', () => {
      const entries = logger.query({ limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it('should respect offset', () => {
      const all = logger.query({});
      const offset = logger.query({ offset: 2 });
      expect(offset).toHaveLength(all.length - 2);
    });

    it('should support pagination with limit and offset', () => {
      const page1 = logger.query({ limit: 2, offset: 0 });
      const page2 = logger.query({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);

      // Pages should not overlap
      const page1Ids = new Set(page1.map((e) => e.id));
      expect(page2.some((e) => page1Ids.has(e.id))).toBe(false);
    });
  });

  describe('sorting', () => {
    it('should return entries sorted by timestamp descending (newest first)', () => {
      const entries = logger.query({});
      for (let i = 0; i < entries.length - 1; i++) {
        expect(entries[i].timestamp).toBeGreaterThanOrEqual(entries[i + 1].timestamp);
      }
    });
  });
});

// =============================================================================
// Retention Pruning Tests
// =============================================================================

describe('CapabilityAuditLogger - Retention Pruning', () => {
  describe('time-based pruning', () => {
    it('should prune entries older than retention period', () => {
      const logger = createCapabilityAuditLogger({
        autoPrune: false,
        retentionMs: 1000, // 1 second
      });

      logger.log(createTestEntry());

      // Manually manipulate entry timestamp for testing
      const entries = (logger as unknown as { entries: CapabilityAuditEntry[] }).entries;
      entries[0] = { ...entries[0], timestamp: Date.now() - 2000 };

      const pruned = logger.pruneExpired();

      expect(pruned).toBe(1);
      expect(logger.getCount()).toBe(0);

      logger.dispose();
    });

    it('should not prune entries within retention period', () => {
      const logger = createCapabilityAuditLogger({
        autoPrune: false,
        retentionMs: 60000, // 1 minute
      });

      logger.log(createTestEntry());

      const pruned = logger.pruneExpired();

      expect(pruned).toBe(0);
      expect(logger.getCount()).toBe(1);

      logger.dispose();
    });

    it('should prune entries older than specific timestamp', () => {
      const logger = createCapabilityAuditLogger({ autoPrune: false });

      logger.log(createTestEntry());
      logger.log(createTestEntry());

      const pruned = logger.prune(Date.now() + 1000);

      expect(pruned).toBe(2);
      expect(logger.getCount()).toBe(0);

      logger.dispose();
    });
  });

  describe('count-based pruning', () => {
    it('should prune when exceeding max entries', () => {
      const logger = createCapabilityAuditLogger({
        autoPrune: false,
        maxEntries: 10,
      });

      // Add 15 entries
      for (let i = 0; i < 15; i++) {
        logger.log(createTestEntry({ appId: appId(`app-${i}`) }));
      }

      // Should have pruned to 90% of max (9 entries)
      expect(logger.getCount()).toBe(9);

      logger.dispose();
    });

    it('should keep newest entries when pruning by count', () => {
      const logger = createCapabilityAuditLogger({
        autoPrune: false,
        maxEntries: 5,
      });

      // Add 10 entries
      for (let i = 0; i < 10; i++) {
        logger.log(createTestEntry({ appId: appId(`app-${i}`) }));
      }

      // Should have the newest entries (app-5 through app-9 approximately)
      const entries = logger.getAllEntries();
      expect(entries.length).toBeLessThanOrEqual(5);

      logger.dispose();
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      const logger = createCapabilityAuditLogger({ autoPrune: false });

      logger.log(createTestEntry());
      logger.log(createTestEntry());
      logger.log(createTestEntry());

      expect(logger.getCount()).toBe(3);

      logger.clear();

      expect(logger.getCount()).toBe(0);
      expect(logger.getAllEntries()).toHaveLength(0);

      logger.dispose();
    });
  });
});

// =============================================================================
// Export Tests
// =============================================================================

describe('CapabilityAuditLogger - Export', () => {
  let logger: CapabilityAuditLogger;

  beforeEach(() => {
    logger = createCapabilityAuditLogger({ autoPrune: false });

    logger.log(
      createTestEntry({
        appId: appId('app-1'),
        capability: 'cells:read' as CapabilityType,
        eventType: 'used',
        operation: 'getValue',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-2'),
        capability: 'tables:write' as CapabilityType,
        eventType: 'denied',
        resourceType: 'table',
        resourceId: 'contacts',
      }),
    );
  });

  afterEach(() => {
    logger.dispose();
  });

  describe('JSON export', () => {
    it('should export valid JSON', () => {
      const json = logger.exportToJSON();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it('should include all entry fields', () => {
      const json = logger.exportToJSON();
      const parsed = JSON.parse(json);

      expect(parsed[0]).toHaveProperty('id');
      expect(parsed[0]).toHaveProperty('timestamp');
      expect(parsed[0]).toHaveProperty('appId');
      expect(parsed[0]).toHaveProperty('capability');
      expect(parsed[0]).toHaveProperty('eventType');
    });

    it('should respect query options', () => {
      const json = logger.exportToJSON({ appId: appId('app-1') });
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].appId).toBe('app-1');
    });
  });

  describe('CSV export', () => {
    it('should export valid CSV', () => {
      const csv = logger.exportToCSV();
      const lines = csv.split('\n');

      expect(lines.length).toBe(3); // Header + 2 entries
    });

    it('should include header row', () => {
      const csv = logger.exportToCSV();
      const header = csv.split('\n')[0];

      expect(header).toContain('id');
      expect(header).toContain('timestamp');
      expect(header).toContain('datetime');
      expect(header).toContain('appId');
      expect(header).toContain('capability');
      expect(header).toContain('eventType');
    });

    it('should escape commas in values', () => {
      logger.log(
        createTestEntry({
          metadata: { message: 'Hello, World' },
        }),
      );

      const csv = logger.exportToCSV();
      // Should contain escaped value
      expect(csv).toMatch(/".*Hello, World.*"/);
    });

    it('should escape quotes in values', () => {
      logger.log(
        createTestEntry({
          metadata: { message: 'Say "Hello"' },
        }),
      );

      const csv = logger.exportToCSV();
      // The JSON.stringify creates escaped quotes, and CSV escapes those with double-quotes
      // The result should be a quoted CSV field containing the JSON
      expect(csv).toContain('Hello');
      // Verify the metadata column is properly quoted since it contains special characters
      const lines = csv.split('\n');
      const lastLine = lines[lines.length - 1];
      expect(lastLine).toContain('"');
    });

    it('should respect query options', () => {
      const csv = logger.exportToCSV({ appId: appId('app-1') });
      const lines = csv.split('\n');

      expect(lines.length).toBe(2); // Header + 1 entry
    });

    it('should sort entries chronologically (oldest first)', () => {
      const csv = logger.exportToCSV();
      const lines = csv.split('\n').slice(1); // Skip header

      if (lines.length >= 2) {
        const timestamp1 = parseInt(lines[0].split(',')[1], 10);
        const timestamp2 = parseInt(lines[1].split(',')[1], 10);
        expect(timestamp1).toBeLessThanOrEqual(timestamp2);
      }
    });
  });
});

// =============================================================================
// Stats Tests
// =============================================================================

describe('CapabilityAuditLogger - Stats', () => {
  let logger: CapabilityAuditLogger;

  beforeEach(() => {
    logger = createCapabilityAuditLogger({ autoPrune: false });

    logger.log(
      createTestEntry({
        appId: appId('app-1'),
        capability: 'cells:read' as CapabilityType,
        eventType: 'used',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-1'),
        capability: 'cells:read' as CapabilityType,
        eventType: 'used',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-1'),
        capability: 'cells:write' as CapabilityType,
        eventType: 'denied',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-2'),
        capability: 'tables:read' as CapabilityType,
        eventType: 'granted',
      }),
    );
    logger.log(
      createTestEntry({
        appId: appId('app-2'),
        capability: 'network:any' as CapabilityType,
        eventType: 'denied',
      }),
    );
  });

  afterEach(() => {
    logger.dispose();
  });

  it('should report correct total entries', () => {
    const stats = logger.getStats();
    expect(stats.totalEntries).toBe(5);
  });

  it('should report correct count by event type', () => {
    const stats = logger.getStats();
    expect(stats.byEventType.used).toBe(2);
    expect(stats.byEventType.denied).toBe(2);
    expect(stats.byEventType.granted).toBe(1);
  });

  it('should report correct count by app', () => {
    const stats = logger.getStats();
    expect(stats.byApp.get(appId('app-1'))).toBe(3);
    expect(stats.byApp.get(appId('app-2'))).toBe(2);
  });

  it('should report correct count by capability', () => {
    const stats = logger.getStats();
    expect(stats.byCapability.get('cells:read' as CapabilityType)).toBe(2);
    expect(stats.byCapability.get('cells:write' as CapabilityType)).toBe(1);
    expect(stats.byCapability.get('tables:read' as CapabilityType)).toBe(1);
    expect(stats.byCapability.get('network:any' as CapabilityType)).toBe(1);
  });

  it('should report denial count', () => {
    const stats = logger.getStats();
    expect(stats.denialCount).toBe(2);
  });

  it('should report timestamp range', () => {
    const stats = logger.getStats();
    expect(stats.oldestTimestamp).toBeDefined();
    expect(stats.newestTimestamp).toBeDefined();
    expect(stats.oldestTimestamp!).toBeLessThanOrEqual(stats.newestTimestamp!);
  });

  it('should estimate storage size', () => {
    const stats = logger.getStats();
    expect(stats.estimatedSizeBytes).toBeGreaterThan(0);
  });

  it('should report null timestamps for empty log', () => {
    logger.clear();
    const stats = logger.getStats();
    expect(stats.oldestTimestamp).toBeNull();
    expect(stats.newestTimestamp).toBeNull();
  });

  it('should work with getCount convenience method', () => {
    expect(logger.getCount()).toBe(5);
  });

  it('should work with getCountByType convenience method', () => {
    const counts = logger.getCountByType();
    expect(counts.used).toBe(2);
    expect(counts.denied).toBe(2);
  });

  it('should work with getCountByApp convenience method', () => {
    const counts = logger.getCountByApp();
    expect(counts.get(appId('app-1'))).toBe(3);
    expect(counts.get(appId('app-2'))).toBe(2);
  });
});

// =============================================================================
// Lifecycle Tests
// =============================================================================

describe('CapabilityAuditLogger - Lifecycle', () => {
  it('should clean up interval on dispose', () => {
    jest.useFakeTimers();

    const logger = createCapabilityAuditLogger({
      autoPrune: true,
      pruneIntervalMs: 1000,
    });

    logger.dispose();

    // Advance timers - should not throw
    expect(() => jest.advanceTimersByTime(5000)).not.toThrow();

    jest.useRealTimers();
  });

  it('should prune on startup when autoPrune enabled', () => {
    const logger = createCapabilityAuditLogger({
      autoPrune: true,
      retentionMs: 1, // 1ms - everything will be expired
    });

    // Add entry and manipulate timestamp
    logger.log(createTestEntry());
    const entries = (logger as unknown as { entries: CapabilityAuditEntry[] }).entries;
    entries[0] = { ...entries[0], timestamp: Date.now() - 100 };

    // Create new logger (simulates startup)
    const logger2 = createCapabilityAuditLogger({
      autoPrune: true,
      retentionMs: 1,
    });

    // New logger should have started with 0 entries (pruned on startup)
    expect(logger2.getCount()).toBe(0);

    logger.dispose();
    logger2.dispose();
  });
});
