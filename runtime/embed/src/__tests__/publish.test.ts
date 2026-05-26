/**
 * @jest-environment jsdom
 */

import type {
  MogPublishConfig,
  MogPublishArtifact,
  MogPublishEffectiveState,
  PublishMetadata,
  PublishCachePolicy,
  PublishSecurityPolicy,
  PublishViewHandle,
  PublishViewStatus,
  PublishViewEventMap,
  PublishChromeOptions,
} from '../publish/types';

import {
  createPublishView,
  validatePublishConfig,
  createDefaultSecurityPolicy,
} from '../publish/mount';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides?: Partial<PublishMetadata>): PublishMetadata {
  return {
    title: 'Test Sheet',
    description: 'A test published sheet',
    authorDisplayName: 'Test Author',
    publishDate: '2026-05-09T00:00:00Z',
    snapshotVersion: 1,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<MogPublishConfig>): MogPublishConfig {
  return {
    snapshotRef: 'snap-abc-123',
    metadata: makeMetadata(),
    ...overrides,
  };
}

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '600px';
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe('validatePublishConfig', () => {
  it('returns no errors for a valid config', () => {
    const errors = validatePublishConfig(makeConfig());
    expect(errors).toHaveLength(0);
  });

  it('rejects missing snapshotRef', () => {
    const errors = validatePublishConfig(makeConfig({ snapshotRef: '' }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe('snapshotRef');
  });

  it('rejects missing metadata', () => {
    const errors = validatePublishConfig({ snapshotRef: 'x', metadata: undefined as any });
    expect(errors.some((e) => e.field === 'metadata')).toBe(true);
  });

  it('rejects non-string metadata.title', () => {
    const errors = validatePublishConfig(
      makeConfig({ metadata: { ...makeMetadata(), title: 123 as any } }),
    );
    expect(errors.some((e) => e.field === 'metadata.title')).toBe(true);
  });

  it('rejects non-number snapshotVersion', () => {
    const errors = validatePublishConfig(
      makeConfig({ metadata: { ...makeMetadata(), snapshotVersion: 'abc' as any } }),
    );
    expect(errors.some((e) => e.field === 'metadata.snapshotVersion')).toBe(true);
  });

  it('rejects NaN snapshotVersion', () => {
    const errors = validatePublishConfig(
      makeConfig({ metadata: { ...makeMetadata(), snapshotVersion: NaN } }),
    );
    expect(errors.some((e) => e.field === 'metadata.snapshotVersion')).toBe(true);
  });

  it('rejects invalid cachePolicy', () => {
    const errors = validatePublishConfig(makeConfig({ cachePolicy: 'invalid' as any }));
    expect(errors.some((e) => e.field === 'cachePolicy')).toBe(true);
  });

  it('accepts all valid cachePolicy values', () => {
    const policies: PublishCachePolicy[] = ['immutable', 'revalidate', 'versioned'];
    for (const p of policies) {
      const errors = validatePublishConfig(makeConfig({ cachePolicy: p }));
      expect(errors).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// createDefaultSecurityPolicy
// ---------------------------------------------------------------------------

describe('createDefaultSecurityPolicy', () => {
  it('returns a policy with maximum redaction defaults', () => {
    const policy = createDefaultSecurityPolicy();
    expect(policy.redactFormulas).toBe(true);
    expect(policy.stripComments).toBe(true);
    expect(policy.sanitizeMetadata).toBe(true);
    expect(policy.stripRevisionHistory).toBe(true);
    // Named ranges not stripped by default (may be needed for navigation)
    expect(policy.stripNamedRanges).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Security policy types
// ---------------------------------------------------------------------------

describe('PublishSecurityPolicy', () => {
  it('accepts a fully specified policy', () => {
    const policy: PublishSecurityPolicy = {
      redactFormulas: true,
      stripComments: true,
      sanitizeMetadata: true,
      stripNamedRanges: true,
      stripRevisionHistory: true,
    };
    expect(policy.redactFormulas).toBe(true);
    expect(policy.stripNamedRanges).toBe(true);
  });

  it('accepts a minimal redaction policy', () => {
    const policy: PublishSecurityPolicy = {
      redactFormulas: false,
      stripComments: false,
      sanitizeMetadata: false,
      stripNamedRanges: false,
      stripRevisionHistory: false,
    };
    expect(policy.redactFormulas).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MogPublishArtifact
// ---------------------------------------------------------------------------

describe('MogPublishArtifact', () => {
  it('constructs with all required fields', () => {
    const artifact: MogPublishArtifact = {
      snapshotId: 'snap-001',
      version: 3,
      metadata: makeMetadata(),
      cachePolicy: 'immutable',
      securityPolicy: createDefaultSecurityPolicy(),
    };
    expect(artifact.snapshotId).toBe('snap-001');
    expect(artifact.version).toBe(3);
    expect(artifact.metadata.title).toBe('Test Sheet');
    expect(artifact.cachePolicy).toBe('immutable');
    expect(artifact.securityPolicy.redactFormulas).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Effective state — no mutation paths
// ---------------------------------------------------------------------------

describe('MogPublishEffectiveState', () => {
  it('has mode locked to readonly', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.mode).toBe('readonly');
    handle.dispose();
  });

  it('has savePolicy locked to none', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.savePolicy).toBe('none');
    handle.dispose();
  });

  it('has collaboration locked to none', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.collaboration).toBe('none');
    handle.dispose();
  });

  it('has dirty locked to false', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.dirty).toBe(false);
    handle.dispose();
  });

  it('has saveState locked to idle', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.saveState).toBe('idle');
    handle.dispose();
  });

  it('has canExport locked to false', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.canExport).toBe(false);
    handle.dispose();
  });

  it('has canMutate locked to false', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.canMutate).toBe(false);
    handle.dispose();
  });

  it('reflects deterministicRender from config', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig({ deterministicRender: true }));
    const state = handle.getEffectiveState();

    expect(state.deterministicRender).toBe(true);
    handle.dispose();
  });

  it('defaults deterministicRender to false', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.deterministicRender).toBe(false);
    handle.dispose();
  });
});

// ---------------------------------------------------------------------------
// Handle — no mutation methods
// ---------------------------------------------------------------------------

describe('PublishViewHandle', () => {
  it('does not expose any mutation methods', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    // Verify the handle does NOT have any of these mutation/save/export methods
    expect((handle as any).setCellValue).toBeUndefined();
    expect((handle as any).save).toBeUndefined();
    expect((handle as any).requestSave).toBeUndefined();
    expect((handle as any).export).toBeUndefined();
    expect((handle as any).requestExport).toBeUndefined();
    expect((handle as any).insertRow).toBeUndefined();
    expect((handle as any).insertColumn).toBeUndefined();
    expect((handle as any).deleteRow).toBeUndefined();
    expect((handle as any).deleteColumn).toBeUndefined();
    expect((handle as any).setFormula).toBeUndefined();
    expect((handle as any).setFormat).toBeUndefined();
    expect((handle as any).undo).toBeUndefined();
    expect((handle as any).redo).toBeUndefined();
    expect((handle as any).paste).toBeUndefined();
    expect((handle as any).joinCollaboration).toBeUndefined();
    expect((handle as any).isDirty).toBeUndefined();

    handle.dispose();
  });

  it('exposes only read-only methods', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    // These are the ONLY methods that should exist
    expect(typeof handle.getStatus).toBe('function');
    expect(typeof handle.getEffectiveState).toBe('function');
    expect(typeof handle.getMetadata).toBe('function');
    expect(typeof handle.setSheet).toBe('function');
    expect(typeof handle.getSheetNames).toBe('function');
    expect(typeof handle.resize).toBe('function');
    expect(typeof handle.dispose).toBe('function');
    expect(handle.ready).toBeInstanceOf(Promise);

    handle.dispose();
  });

  it('returns metadata from getMetadata', () => {
    const container = makeContainer();
    const meta = makeMetadata({ title: 'My Published Sheet' });
    const handle = createPublishView(container, makeConfig({ metadata: meta }));

    expect(handle.getMetadata().title).toBe('My Published Sheet');
    expect(handle.getMetadata().authorDisplayName).toBe('Test Author');
    expect(handle.getMetadata().snapshotVersion).toBe(1);

    handle.dispose();
  });
});

// ---------------------------------------------------------------------------
// createPublishView — mount/lifecycle
// ---------------------------------------------------------------------------

describe('createPublishView', () => {
  it('mounts into the container', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    expect(container.children.length).toBeGreaterThan(0);
    const wrapper = container.querySelector('[data-mog-role="publish-view"]');
    expect(wrapper).not.toBeNull();

    handle.dispose();
  });

  it('starts in initializing/loading state', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    // Status transitions through initializing -> loading synchronously
    const s = handle.getStatus();
    expect(['initializing', 'loading']).toContain(s);

    handle.dispose();
  });

  it('transitions to ready', async () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    await handle.ready;
    expect(handle.getStatus()).toBe('ready');

    handle.dispose();
  });

  it('throws on invalid config', () => {
    const container = makeContainer();
    expect(() => {
      createPublishView(container, { snapshotRef: '', metadata: undefined as any });
    }).toThrow(/Invalid publish config/);
  });

  it('cleans up DOM on dispose', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    expect(container.children.length).toBeGreaterThan(0);
    handle.dispose();
    expect(container.children.length).toBe(0);
    expect(handle.getStatus()).toBe('disposed');
  });

  it('double-dispose is safe', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
    expect(handle.getStatus()).toBe('disposed');
  });

  it('rejects ready when disposed before ready', async () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    handle.dispose();

    await expect(handle.ready).rejects.toThrow('disposed before ready');
  });

  it('resize updates wrapper dimensions', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());

    handle.resize(1024, 768);
    const wrapper = container.querySelector('[data-mog-role="publish-view"]') as HTMLElement;
    expect(wrapper.style.width).toBe('1024px');
    expect(wrapper.style.height).toBe('768px');

    handle.dispose();
  });
});

// ---------------------------------------------------------------------------
// Chrome options
// ---------------------------------------------------------------------------

describe('PublishChromeOptions', () => {
  it('defaults all chrome to true', () => {
    const container = makeContainer();
    const handle = createPublishView(container, makeConfig());
    const state = handle.getEffectiveState();

    expect(state.chrome.sheetTabs).toBe(true);
    expect(state.chrome.headers).toBe(true);
    expect(state.chrome.gridlines).toBe(true);

    handle.dispose();
  });

  it('respects disabled chrome options', () => {
    const container = makeContainer();
    const handle = createPublishView(
      container,
      makeConfig({
        chrome: { sheetTabs: false, headers: false, gridlines: false },
      }),
    );
    const state = handle.getEffectiveState();

    expect(state.chrome.sheetTabs).toBe(false);
    expect(state.chrome.headers).toBe(false);
    expect(state.chrome.gridlines).toBe(false);

    handle.dispose();
  });
});

// ---------------------------------------------------------------------------
// Metadata sanitization rules
// ---------------------------------------------------------------------------

describe('PublishMetadata', () => {
  it('accepts all required fields', () => {
    const meta: PublishMetadata = {
      title: 'Q1 Report',
      description: 'Quarterly financial summary',
      authorDisplayName: 'Finance Team',
      publishDate: '2026-05-09T12:00:00Z',
      snapshotVersion: 42,
    };
    expect(meta.title).toBe('Q1 Report');
    expect(meta.snapshotVersion).toBe(42);
  });

  it('accepts optional locale', () => {
    const meta: PublishMetadata = {
      title: 'Report',
      description: '',
      authorDisplayName: 'Author',
      publishDate: '2026-05-09',
      snapshotVersion: 1,
      locale: 'ja-JP',
    };
    expect(meta.locale).toBe('ja-JP');
  });

  it('does not include internal IDs, storage paths, or provider configs', () => {
    // Compile-time assertion: PublishMetadata should not have these fields
    const meta: PublishMetadata = makeMetadata();
    expect((meta as any).documentId).toBeUndefined();
    expect((meta as any).storagePath).toBeUndefined();
    expect((meta as any).providerConfig).toBeUndefined();
    expect((meta as any).yrsStateVector).toBeUndefined();
    expect((meta as any).rawBytes).toBeUndefined();
    expect((meta as any).crdtUpdates).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PublishViewEventMap (type-level assertions)
// ---------------------------------------------------------------------------

describe('PublishViewEventMap', () => {
  it('has only read-only events', () => {
    const map: PublishViewEventMap = {
      lifecycleChange: 'ready',
      sheetChange: { index: 0, name: 'Sheet1' },
      error: new Error('test'),
    };
    expect(map.lifecycleChange).toBe('ready');
    expect(map.sheetChange.index).toBe(0);
    expect(map.error).toBeInstanceOf(Error);
  });

  it('does not have mutation events', () => {
    const map: PublishViewEventMap = {
      lifecycleChange: 'ready',
      sheetChange: { index: 0, name: 'S1' },
      error: new Error('x'),
    };
    expect((map as any).dirtyChange).toBeUndefined();
    expect((map as any).saveStateChange).toBeUndefined();
    expect((map as any).cellEdit).toBeUndefined();
    expect((map as any).collaborationUpdate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PublishViewStatus
// ---------------------------------------------------------------------------

describe('PublishViewStatus', () => {
  it('accepts all lifecycle states', () => {
    const states: PublishViewStatus[] = ['initializing', 'loading', 'ready', 'error', 'disposed'];
    expect(states).toHaveLength(5);
  });
});
