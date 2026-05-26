import type {
  EmbedMode,
  MogEmbedSourceRef,
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedResolvedSource,
  MogEmbedHostPolicy,
  MogEmbedLifecycleState,
  MogEmbedEventMap,
  MogEmbedChromeOptions,
  MogEmbedThemeOptions,
  MogEmbedSavePolicy,
  MogEmbedCollaborationMode,
} from '../config';
import { validateMogEmbedConfig, assertValidMogEmbedConfig } from '../config';

// ---------------------------------------------------------------------------
// EmbedMode
// ---------------------------------------------------------------------------

describe('EmbedMode', () => {
  it('accepts all defined mode values', () => {
    const modes: EmbedMode[] = ['readonly', 'comment', 'review', 'protected-edit', 'full-edit'];
    expect(modes).toHaveLength(5);
    // Round-trip: each value satisfies the type at compile time.
    modes.forEach((m) => {
      expect(typeof m).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// MogEmbedSourceRef
// ---------------------------------------------------------------------------

describe('MogEmbedSourceRef', () => {
  it('constructs a document source ref', () => {
    const ref: MogEmbedSourceRef = { kind: 'document', ref: 'doc-123' };
    expect(ref.kind).toBe('document');
    expect(ref.ref).toBe('doc-123');
  });

  it('constructs a file source ref', () => {
    const ref: MogEmbedSourceRef = { kind: 'file', ref: 'issued-file-ref' };
    expect(ref.kind).toBe('file');
    expect(ref.ref).toBe('issued-file-ref');
  });

  it('accepts all valid kind values', () => {
    const kinds: MogEmbedSourceRef['kind'][] = [
      'document',
      'file',
      'snapshot',
      'host-callback',
      'live-session',
    ];
    expect(kinds).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// MogEmbedConfig — full and minimal
// ---------------------------------------------------------------------------

describe('MogEmbedConfig', () => {
  it('constructs with all fields', () => {
    const config: MogEmbedConfig = {
      source: { kind: 'file', ref: 'issued-file-ref' },
      requestedMode: 'full-edit',
      sheet: 0,
      range: 'A1:C10',
      chrome: {
        formulaBar: true,
        sheetTabs: true,
        headers: true,
        gridlines: false,
        scrollbars: true,
        zoomControls: true,
      },
      theme: { workbookTheme: 'from-document', chromeTheme: 'host' },
      locale: 'en-US',
      requestedCapabilities: ['edit', 'comment'],
      capabilityGrantRef: 'grant-abc',
      requestedSavePolicy: 'autosave',
      requestedCollaboration: 'live',
    };
    expect(config.source.kind).toBe('file');
    expect(config.requestedMode).toBe('full-edit');
    expect(config.sheet).toBe(0);
    expect(config.range).toBe('A1:C10');
    expect(config.chrome?.formulaBar).toBe(true);
    expect(config.theme?.workbookTheme).toBe('from-document');
    expect(config.locale).toBe('en-US');
    expect(config.requestedCapabilities).toEqual(['edit', 'comment']);
    expect(config.capabilityGrantRef).toBe('grant-abc');
    expect(config.requestedSavePolicy).toBe('autosave');
    expect(config.requestedCollaboration).toBe('live');
  });

  it('constructs with only required fields', () => {
    const config: MogEmbedConfig = {
      source: { kind: 'document', ref: 'doc-456' },
    };
    expect(config.source.kind).toBe('document');
    expect(config.source.ref).toBe('doc-456');
    expect(config.requestedMode).toBeUndefined();
    expect(config.sheet).toBeUndefined();
    expect(config.range).toBeUndefined();
    expect(config.chrome).toBeUndefined();
    expect(config.theme).toBeUndefined();
    expect(config.locale).toBeUndefined();
    expect(config.requestedCapabilities).toBeUndefined();
    expect(config.capabilityGrantRef).toBeUndefined();
    expect(config.requestedSavePolicy).toBeUndefined();
    expect(config.requestedCollaboration).toBeUndefined();
  });

  it('accepts sheet as a string name', () => {
    const config: MogEmbedConfig = {
      source: { kind: 'file', ref: 'f' },
      sheet: 'Sheet1',
    };
    expect(config.sheet).toBe('Sheet1');
  });
});

describe('MogEmbedConfig validation', () => {
  it('accepts a valid full config', () => {
    const errors = validateMogEmbedConfig({
      source: { kind: 'file', ref: 'issued-file-ref' },
      requestedMode: 'review',
      sheet: 'Sheet1',
      range: 'A1:B2',
      chrome: {
        formulaBar: false,
        sheetTabs: true,
        headers: true,
        gridlines: false,
        scrollbars: true,
        zoomControls: true,
      },
      theme: { workbookTheme: 'from-document', chromeTheme: 'host' },
      locale: 'en-US',
      requestedCapabilities: ['view', 'comment'],
      capabilityGrantRef: 'grant-1',
      requestedSavePolicy: 'host-callback',
      requestedCollaboration: 'local-only',
    });
    expect(errors).toEqual([]);
  });

  it('rejects raw source URL/path authority', () => {
    const errors = validateMogEmbedConfig({
      source: {
        kind: 'file',
        ref: 'issued-file-ref',
        url: 'https://example.com/a.xlsx',
        path: '/tmp/a.xlsx',
      },
    });
    expect(errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['source.url', 'source.path']),
    );
  });

  it('rejects forbidden host authority fields', () => {
    const errors = validateMogEmbedConfig({
      source: { kind: 'file', ref: 'issued-file-ref' },
      providerConfig: {},
      bearerToken: 'secret',
    });
    expect(errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['providerConfig', 'bearerToken']),
    );
  });

  it('throws from assertValidMogEmbedConfig on invalid config', () => {
    expect(() => assertValidMogEmbedConfig({ source: { kind: 'file', ref: '' } })).toThrow(
      /Invalid MogEmbedConfig/,
    );
  });
});

// ---------------------------------------------------------------------------
// MogEmbedEffectiveState
// ---------------------------------------------------------------------------

describe('MogEmbedEffectiveState', () => {
  it('constructs with all fields', () => {
    const state: MogEmbedEffectiveState = {
      mode: 'readonly',
      capabilities: ['view', 'export'],
      deniedCapabilities: ['edit'],
      savePolicy: 'none',
      collaboration: 'none',
      dirty: false,
      saveState: 'idle',
    };
    expect(state.mode).toBe('readonly');
    expect(state.capabilities).toEqual(['view', 'export']);
    expect(state.deniedCapabilities).toEqual(['edit']);
    expect(state.savePolicy).toBe('none');
    expect(state.collaboration).toBe('none');
    expect(state.dirty).toBe(false);
    expect(state.saveState).toBe('idle');
  });

  it('accepts all saveState values', () => {
    const states: MogEmbedEffectiveState['saveState'][] = ['idle', 'saving', 'saved', 'error'];
    expect(states).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// MogEmbedLifecycleState
// ---------------------------------------------------------------------------

describe('MogEmbedLifecycleState', () => {
  it('accepts all lifecycle state values', () => {
    const states: MogEmbedLifecycleState[] = [
      'initializing',
      'loading',
      'ready',
      'error',
      'disposed',
    ];
    expect(states).toHaveLength(5);
    states.forEach((s) => expect(typeof s).toBe('string'));
  });
});

// ---------------------------------------------------------------------------
// MogEmbedEventMap
// ---------------------------------------------------------------------------

describe('MogEmbedEventMap', () => {
  it('has the expected event shapes', () => {
    // Compile-time assertion: construct a conformant map value object.
    const map: MogEmbedEventMap = {
      lifecycleChange: 'ready',
      effectiveStateChange: {
        mode: 'full-edit',
        capabilities: [],
        deniedCapabilities: [],
        savePolicy: 'autosave',
        collaboration: 'live',
        dirty: true,
        saveState: 'saving',
      },
      sheetChange: { index: 0, name: 'Sheet1', sheetId: 's1' },
      selectionChange: { row: 0, col: 0 },
      dirtyChange: true,
      saveStateChange: 'saved',
      capabilityDenied: { capability: 'edit', reason: 'no grant' },
      error: new Error('boom'),
    };
    expect(map.lifecycleChange).toBe('ready');
    expect(map.sheetChange.index).toBe(0);
    expect(map.selectionChange.row).toBe(0);
    expect(map.dirtyChange).toBe(true);
    expect(map.saveStateChange).toBe('saved');
    expect(map.capabilityDenied.capability).toBe('edit');
    expect(map.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Host policy
// ---------------------------------------------------------------------------

describe('MogEmbedHostPolicy', () => {
  it('resolves source bytes and effective state through host policy callbacks', async () => {
    const resolvedSource: MogEmbedResolvedSource = {
      bytes: new Uint8Array([0x50, 0x4b]),
      authorizationRef: 'authz-123',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const policy: MogEmbedHostPolicy = {
      resolveSource: () => resolvedSource,
      resolveEffectiveState: () => ({
        mode: 'readonly',
        capabilities: [],
        deniedCapabilities: ['edit'],
        savePolicy: 'none',
        collaboration: 'none',
        dirty: false,
        saveState: 'idle',
      }),
    };

    await expect(
      Promise.resolve(
        policy.resolveSource({
          source: { kind: 'file', ref: 'issued-file-ref' },
        }),
      ),
    ).resolves.toBe(resolvedSource);
    expect(
      await policy.resolveEffectiveState({
        source: { kind: 'file', ref: 'issued-file-ref' },
      }),
    ).toMatchObject({
      mode: 'readonly',
      capabilities: [],
      deniedCapabilities: ['edit'],
    });
  });
});

// ---------------------------------------------------------------------------
// MogEmbedChromeOptions
// ---------------------------------------------------------------------------

describe('MogEmbedChromeOptions', () => {
  it('accepts all boolean fields', () => {
    const opts: MogEmbedChromeOptions = {
      formulaBar: true,
      sheetTabs: false,
      headers: true,
      gridlines: false,
      scrollbars: true,
      zoomControls: false,
    };
    expect(opts.formulaBar).toBe(true);
    expect(opts.sheetTabs).toBe(false);
    expect(opts.headers).toBe(true);
    expect(opts.gridlines).toBe(false);
    expect(opts.scrollbars).toBe(true);
    expect(opts.zoomControls).toBe(false);
  });

  it('allows all fields to be omitted', () => {
    const opts: MogEmbedChromeOptions = {};
    expect(opts.formulaBar).toBeUndefined();
    expect(opts.sheetTabs).toBeUndefined();
    expect(opts.headers).toBeUndefined();
    expect(opts.gridlines).toBeUndefined();
    expect(opts.scrollbars).toBeUndefined();
    expect(opts.zoomControls).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MogEmbedThemeOptions
// ---------------------------------------------------------------------------

describe('MogEmbedThemeOptions', () => {
  it('accepts workbookTheme and chromeTheme', () => {
    const theme: MogEmbedThemeOptions = {
      workbookTheme: 'from-document',
      chromeTheme: 'host',
    };
    expect(theme.workbookTheme).toBe('from-document');
    expect(theme.chromeTheme).toBe('host');
  });

  it('accepts custom string themes', () => {
    const theme: MogEmbedThemeOptions = {
      workbookTheme: 'dark-mode',
      chromeTheme: 'custom-brand',
    };
    expect(theme.workbookTheme).toBe('dark-mode');
    expect(theme.chromeTheme).toBe('custom-brand');
  });
});

// ---------------------------------------------------------------------------
// MogEmbedSavePolicy
// ---------------------------------------------------------------------------

describe('MogEmbedSavePolicy', () => {
  it('accepts all save policy values', () => {
    const policies: MogEmbedSavePolicy[] = ['none', 'export-only', 'host-callback', 'autosave'];
    expect(policies).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// MogEmbedCollaborationMode
// ---------------------------------------------------------------------------

describe('MogEmbedCollaborationMode', () => {
  it('accepts all collaboration mode values', () => {
    const modes: MogEmbedCollaborationMode[] = ['none', 'local-only', 'live'];
    expect(modes).toHaveLength(3);
  });
});
