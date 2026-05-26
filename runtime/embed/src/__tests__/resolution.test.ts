import type { MogEmbedConfig, MogEmbedEffectiveState } from '../config';
import { resolveEffectiveState, type TrustContext } from '../resolution';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<MogEmbedConfig> = {}): MogEmbedConfig {
  return {
    source: { kind: 'file', ref: 'test.xlsx' },
    ...overrides,
  };
}

function makeTrust(overrides: Partial<TrustContext> = {}): TrustContext {
  return {
    boundary: 'same-origin-trusted',
    availableCapabilities: ['edit', 'comment', 'export', 'view'],
    availableSavePolicies: ['none', 'export-only', 'host-callback', 'autosave'],
    availableCollaborationModes: ['none', 'local-only', 'live'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

describe('resolveEffectiveState – mode', () => {
  it('grants requested mode when within ceiling', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'protected-edit' }),
      makeTrust({ maxMode: 'full-edit' }),
    );
    expect(result.mode).toBe('protected-edit');
  });

  it('narrows mode when requested exceeds ceiling', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'full-edit' }),
      makeTrust({ maxMode: 'protected-edit' }),
    );
    expect(result.mode).toBe('protected-edit');
  });

  it('grants exact mode when requested equals ceiling', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'comment' }),
      makeTrust({ maxMode: 'comment' }),
    );
    expect(result.mode).toBe('comment');
  });

  it('defaults to readonly when no mode requested', () => {
    const result = resolveEffectiveState(makeConfig(), makeTrust({ maxMode: 'full-edit' }));
    expect(result.mode).toBe('readonly');
  });

  it('uses full-edit default max for same-origin-trusted', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'full-edit' }),
      makeTrust({ boundary: 'same-origin-trusted' }),
    );
    expect(result.mode).toBe('full-edit');
  });

  it('uses protected-edit default max for iframe-child', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'full-edit' }),
      makeTrust({ boundary: 'iframe-child', maxMode: undefined }),
    );
    expect(result.mode).toBe('protected-edit');
  });

  it('uses protected-edit default max for same-origin-untrusted', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'full-edit' }),
      makeTrust({ boundary: 'same-origin-untrusted', maxMode: undefined }),
    );
    expect(result.mode).toBe('protected-edit');
  });

  it('locks publish boundary to readonly by default', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'full-edit' }),
      makeTrust({ boundary: 'publish', maxMode: undefined }),
    );
    expect(result.mode).toBe('readonly');
  });

  it('iframe-child can still get full-edit if explicitly granted', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'full-edit' }),
      makeTrust({ boundary: 'iframe-child', maxMode: 'full-edit' }),
    );
    expect(result.mode).toBe('full-edit');
  });

  it('readonly always passes through regardless of ceiling', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedMode: 'readonly' }),
      makeTrust({ maxMode: 'readonly' }),
    );
    expect(result.mode).toBe('readonly');
  });
});

// ---------------------------------------------------------------------------
// Capability intersection
// ---------------------------------------------------------------------------

describe('resolveEffectiveState – capabilities', () => {
  it('grants intersection of requested and available', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedCapabilities: ['edit', 'comment', 'magic'] }),
      makeTrust({ availableCapabilities: ['edit', 'comment', 'export'] }),
    );
    expect(result.capabilities).toEqual(['edit', 'comment']);
    expect(result.deniedCapabilities).toEqual(['magic']);
  });

  it('denies all when none available', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedCapabilities: ['edit', 'comment'] }),
      makeTrust({ availableCapabilities: [] }),
    );
    expect(result.capabilities).toEqual([]);
    expect(result.deniedCapabilities).toEqual(['edit', 'comment']);
  });

  it('grants all when all available', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedCapabilities: ['edit', 'view'] }),
      makeTrust({ availableCapabilities: ['edit', 'view', 'export'] }),
    );
    expect(result.capabilities).toEqual(['edit', 'view']);
    expect(result.deniedCapabilities).toEqual([]);
  });

  it('defaults to empty when no capabilities requested', () => {
    const result = resolveEffectiveState(
      makeConfig(),
      makeTrust({ availableCapabilities: ['edit'] }),
    );
    expect(result.capabilities).toEqual([]);
    expect(result.deniedCapabilities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Save policy narrowing
// ---------------------------------------------------------------------------

describe('resolveEffectiveState – save policy', () => {
  it('grants exact match when available', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedSavePolicy: 'autosave' }),
      makeTrust({ availableSavePolicies: ['none', 'autosave'] }),
    );
    expect(result.savePolicy).toBe('autosave');
  });

  it('narrows to best available below requested', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedSavePolicy: 'autosave' }),
      makeTrust({ availableSavePolicies: ['none', 'export-only'] }),
    );
    expect(result.savePolicy).toBe('export-only');
  });

  it('falls back to none when nothing available matches', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedSavePolicy: 'export-only' }),
      makeTrust({ availableSavePolicies: ['host-callback', 'autosave'] }),
    );
    // host-callback and autosave are above export-only, and none isn't in the list
    expect(result.savePolicy).toBe('none');
  });

  it('defaults to none when no save policy requested', () => {
    const result = resolveEffectiveState(makeConfig(), makeTrust());
    expect(result.savePolicy).toBe('none');
  });

  it('grants host-callback when autosave requested but only host-callback available', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedSavePolicy: 'autosave' }),
      makeTrust({ availableSavePolicies: ['none', 'host-callback'] }),
    );
    expect(result.savePolicy).toBe('host-callback');
  });
});

// ---------------------------------------------------------------------------
// Collaboration narrowing
// ---------------------------------------------------------------------------

describe('resolveEffectiveState – collaboration', () => {
  it('grants exact match when available', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedCollaboration: 'live' }),
      makeTrust({ availableCollaborationModes: ['none', 'live'] }),
    );
    expect(result.collaboration).toBe('live');
  });

  it('narrows to best available below requested', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedCollaboration: 'live' }),
      makeTrust({ availableCollaborationModes: ['none', 'local-only'] }),
    );
    expect(result.collaboration).toBe('local-only');
  });

  it('falls back to none when nothing available', () => {
    const result = resolveEffectiveState(
      makeConfig({ requestedCollaboration: 'local-only' }),
      makeTrust({ availableCollaborationModes: ['live'] }),
    );
    expect(result.collaboration).toBe('none');
  });

  it('defaults to none when no collaboration requested', () => {
    const result = resolveEffectiveState(makeConfig(), makeTrust());
    expect(result.collaboration).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Initial state fields
// ---------------------------------------------------------------------------

describe('resolveEffectiveState – initial state', () => {
  it('dirty starts as false', () => {
    const result = resolveEffectiveState(makeConfig(), makeTrust());
    expect(result.dirty).toBe(false);
  });

  it('saveState starts as idle', () => {
    const result = resolveEffectiveState(makeConfig(), makeTrust());
    expect(result.saveState).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Full integration scenario
// ---------------------------------------------------------------------------

describe('resolveEffectiveState – integration', () => {
  it('resolves a realistic iframe-child scenario', () => {
    const config = makeConfig({
      requestedMode: 'full-edit',
      requestedCapabilities: ['edit', 'comment', 'admin', 'export'],
      requestedSavePolicy: 'autosave',
      requestedCollaboration: 'live',
    });

    const trust: TrustContext = {
      boundary: 'iframe-child',
      availableCapabilities: ['edit', 'comment', 'export', 'view'],
      availableSavePolicies: ['none', 'export-only', 'host-callback'],
      availableCollaborationModes: ['none', 'local-only'],
    };

    const result = resolveEffectiveState(config, trust);

    expect(result.mode).toBe('protected-edit');
    expect(result.capabilities).toEqual(['edit', 'comment', 'export']);
    expect(result.deniedCapabilities).toEqual(['admin']);
    expect(result.savePolicy).toBe('host-callback');
    expect(result.collaboration).toBe('local-only');
    expect(result.dirty).toBe(false);
    expect(result.saveState).toBe('idle');
  });

  it('resolves a minimal config with defaults', () => {
    const result = resolveEffectiveState(
      makeConfig(),
      makeTrust({ boundary: 'same-origin-trusted' }),
    );

    expect(result.mode).toBe('readonly');
    expect(result.capabilities).toEqual([]);
    expect(result.deniedCapabilities).toEqual([]);
    expect(result.savePolicy).toBe('none');
    expect(result.collaboration).toBe('none');
  });

  it('type-checks as MogEmbedEffectiveState', () => {
    const result: MogEmbedEffectiveState = resolveEffectiveState(
      makeConfig({ requestedMode: 'review' }),
      makeTrust(),
    );
    expect(result.mode).toBe('review');
  });
});
