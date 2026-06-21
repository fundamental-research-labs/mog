/**
 * Feature Gates Context Tests
 *
 * Verifies:
 * - Default behavior: everything enabled when no gates provided
 * - `ribbon: false` → useFeatureMode('ribbon') returns false
 * - `editing: false` → useFeatureMode('editing') returns false
 * - Tab gating: hidden tabs return false, others default true
 * - Group gating: hidden groups return false, others default true
 * - Capability gating: hidden capabilities return false, others default true
 * - Preset configs: DESKTOP_GATES, VIEWER_GATES gate correctly
 */

import '@testing-library/jest-dom';
import { renderHook } from '@testing-library/react';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import {
  DESKTOP_GATES,
  VIEWER_GATES,
  MINIMAL_EDITOR_GATES,
} from '@mog-sdk/contracts/feature-gates';
import {
  FeatureGatesProvider,
  useFeatureMode,
  useFeatureGate,
  useFeatureGates,
} from '../feature-gates-context';

// =============================================================================
// Helpers
// =============================================================================

function wrapper(gates: FeatureGates) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <FeatureGatesProvider gates={gates}>{children}</FeatureGatesProvider>;
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('FeatureGatesContext', () => {
  describe('defaults (empty gates)', () => {
    it('useFeatureMode returns true for ribbon and editing', () => {
      const { result: ribbon } = renderHook(() => useFeatureMode('ribbon'), {
        wrapper: wrapper({}),
      });
      const { result: editing } = renderHook(() => useFeatureMode('editing'), {
        wrapper: wrapper({}),
      });
      expect(ribbon.current).toBe(true);
      expect(editing.current).toBe(true);
    });

    it('useFeatureGate returns true for any tab/group/capability', () => {
      const { result: homeTab } = renderHook(() => useFeatureGate('tabs', 'home'), {
        wrapper: wrapper({}),
      });
      const { result: clipboard } = renderHook(() => useFeatureGate('groups', 'clipboard'), {
        wrapper: wrapper({}),
      });
      const { result: undo } = renderHook(() => useFeatureGate('capabilities', 'undo'), {
        wrapper: wrapper({}),
      });
      const { result: versionControl } = renderHook(
        () => useFeatureGate('capabilities', 'versionControl'),
        {
          wrapper: wrapper({}),
        },
      );
      expect(homeTab.current).toBe(true);
      expect(clipboard.current).toBe(true);
      expect(undo.current).toBe(true);
      expect(versionControl.current).toBe(true);
    });

    it('useFeatureGates returns the full gates object', () => {
      const { result } = renderHook(() => useFeatureGates(), {
        wrapper: wrapper({}),
      });
      expect(result.current).toEqual({});
    });
  });

  describe('ribbon: false', () => {
    it('hides ribbon', () => {
      const { result } = renderHook(() => useFeatureMode('ribbon'), {
        wrapper: wrapper({ ribbon: false }),
      });
      expect(result.current).toBe(false);
    });

    it('does not affect editing mode', () => {
      const { result } = renderHook(() => useFeatureMode('editing'), {
        wrapper: wrapper({ ribbon: false }),
      });
      expect(result.current).toBe(true);
    });
  });

  describe('editing: false', () => {
    it('disables editing', () => {
      const { result } = renderHook(() => useFeatureMode('editing'), {
        wrapper: wrapper({ editing: false }),
      });
      expect(result.current).toBe(false);
    });

    it('does not affect ribbon visibility', () => {
      const { result } = renderHook(() => useFeatureMode('ribbon'), {
        wrapper: wrapper({ editing: false }),
      });
      expect(result.current).toBe(true);
    });
  });

  describe('tab gating', () => {
    const gates: FeatureGates = {
      tabs: { draw: false, review: false, view: false },
    };

    it('hidden tabs return false', () => {
      const { result: draw } = renderHook(() => useFeatureGate('tabs', 'draw'), {
        wrapper: wrapper(gates),
      });
      const { result: review } = renderHook(() => useFeatureGate('tabs', 'review'), {
        wrapper: wrapper(gates),
      });
      const { result: view } = renderHook(() => useFeatureGate('tabs', 'view'), {
        wrapper: wrapper(gates),
      });
      expect(draw.current).toBe(false);
      expect(review.current).toBe(false);
      expect(view.current).toBe(false);
    });

    it('unspecified tabs default to true', () => {
      const { result: home } = renderHook(() => useFeatureGate('tabs', 'home'), {
        wrapper: wrapper(gates),
      });
      const { result: insert } = renderHook(() => useFeatureGate('tabs', 'insert'), {
        wrapper: wrapper(gates),
      });
      expect(home.current).toBe(true);
      expect(insert.current).toBe(true);
    });
  });

  describe('group gating', () => {
    const gates: FeatureGates = {
      groups: { styles: false, charts: false },
    };

    it('hidden groups return false', () => {
      const { result: styles } = renderHook(() => useFeatureGate('groups', 'styles'), {
        wrapper: wrapper(gates),
      });
      const { result: charts } = renderHook(() => useFeatureGate('groups', 'charts'), {
        wrapper: wrapper(gates),
      });
      expect(styles.current).toBe(false);
      expect(charts.current).toBe(false);
    });

    it('unspecified groups default to true', () => {
      const { result } = renderHook(() => useFeatureGate('groups', 'clipboard'), {
        wrapper: wrapper(gates),
      });
      expect(result.current).toBe(true);
    });
  });

  describe('capability gating', () => {
    const gates: FeatureGates = {
      capabilities: { undo: false, redo: false, formulaBar: false, fileMenu: false },
    };

    it('hidden capabilities return false', () => {
      const { result: undo } = renderHook(() => useFeatureGate('capabilities', 'undo'), {
        wrapper: wrapper(gates),
      });
      const { result: redo } = renderHook(() => useFeatureGate('capabilities', 'redo'), {
        wrapper: wrapper(gates),
      });
      const { result: formulaBar } = renderHook(
        () => useFeatureGate('capabilities', 'formulaBar'),
        { wrapper: wrapper(gates) },
      );
      const { result: fileMenu } = renderHook(() => useFeatureGate('capabilities', 'fileMenu'), {
        wrapper: wrapper(gates),
      });
      expect(undo.current).toBe(false);
      expect(redo.current).toBe(false);
      expect(formulaBar.current).toBe(false);
      expect(fileMenu.current).toBe(false);
    });

    it('unspecified capabilities default to true', () => {
      const { result } = renderHook(() => useFeatureGate('capabilities', 'save'), {
        wrapper: wrapper(gates),
      });
      expect(result.current).toBe(true);
    });
  });

  describe('preset configs', () => {
    it('VIEWER_GATES hides ribbon and disables editing', () => {
      const { result: ribbon } = renderHook(() => useFeatureMode('ribbon'), {
        wrapper: wrapper(VIEWER_GATES),
      });
      const { result: editing } = renderHook(() => useFeatureMode('editing'), {
        wrapper: wrapper(VIEWER_GATES),
      });
      expect(ribbon.current).toBe(false);
      expect(editing.current).toBe(false);
      expect(VIEWER_GATES.capabilities?.versionControl).toBe(false);
    });

    it('DESKTOP_GATES hides unsupported/internal-only tabs', () => {
      const { result: draw } = renderHook(() => useFeatureGate('tabs', 'draw'), {
        wrapper: wrapper(DESKTOP_GATES),
      });
      const { result: pageLayout } = renderHook(() => useFeatureGate('tabs', 'pageLayout'), {
        wrapper: wrapper(DESKTOP_GATES),
      });
      const { result: home } = renderHook(() => useFeatureGate('tabs', 'home'), {
        wrapper: wrapper(DESKTOP_GATES),
      });
      expect(draw.current).toBe(false);
      expect(pageLayout.current).toBe(true);
      expect(home.current).toBe(true);
      expect(DESKTOP_GATES.capabilities?.versionControl).toBe(false);
    });

    it('DESKTOP_GATES does not affect ribbon or editing', () => {
      const { result: ribbon } = renderHook(() => useFeatureMode('ribbon'), {
        wrapper: wrapper(DESKTOP_GATES),
      });
      const { result: editing } = renderHook(() => useFeatureMode('editing'), {
        wrapper: wrapper(DESKTOP_GATES),
      });
      expect(ribbon.current).toBe(true);
      expect(editing.current).toBe(true);
    });

    it('MINIMAL_EDITOR_GATES hides specific tabs and capabilities', () => {
      const { result: draw } = renderHook(() => useFeatureGate('tabs', 'draw'), {
        wrapper: wrapper(MINIMAL_EDITOR_GATES),
      });
      const { result: home } = renderHook(() => useFeatureGate('tabs', 'home'), {
        wrapper: wrapper(MINIMAL_EDITOR_GATES),
      });
      const { result: save } = renderHook(() => useFeatureGate('capabilities', 'save'), {
        wrapper: wrapper(MINIMAL_EDITOR_GATES),
      });
      const { result: undo } = renderHook(() => useFeatureGate('capabilities', 'undo'), {
        wrapper: wrapper(MINIMAL_EDITOR_GATES),
      });
      expect(draw.current).toBe(false);
      expect(home.current).toBe(true);
      expect(save.current).toBe(false);
      expect(undo.current).toBe(true);
      expect(MINIMAL_EDITOR_GATES.capabilities?.versionControl).toBe(false);
    });
  });

  describe('no provider (bare context)', () => {
    it('defaults to all enabled when no provider wraps the tree', () => {
      const { result: ribbon } = renderHook(() => useFeatureMode('ribbon'));
      const { result: editing } = renderHook(() => useFeatureMode('editing'));
      const { result: tab } = renderHook(() => useFeatureGate('tabs', 'home'));
      expect(ribbon.current).toBe(true);
      expect(editing.current).toBe(true);
      expect(tab.current).toBe(true);
    });
  });
});
