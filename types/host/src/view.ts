import type { HostSession } from './kernel';
import type { HostCapabilityLookup } from './capabilities';
import type { HostDiagnosticsSink } from './diagnostics';

export interface ViewFocusBoundary {
  readonly boundaryId: string;
  requestFocus(reason: 'mount' | 'user-input' | 'programmatic'): void;
  releaseFocus(reason: 'unmount' | 'suspend' | 'host-navigation'): void;
}

export interface ViewKeyboardBoundary {
  readonly boundaryId: string;
  readonly captureMode: 'view-local' | 'host-routed' | 'disabled';
  shouldHandleKey(event: {
    readonly key: string;
    readonly code?: string;
    readonly metaKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly altKey?: boolean;
    readonly shiftKey?: boolean;
  }): boolean;
}

export interface ViewSizingPolicy {
  readonly mode: 'fixed' | 'host-resized' | 'fill-container';
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly devicePixelRatioPolicy: 'browser' | 'host-provided' | 'test-fixed';
}

export interface ViewChromeTheme {
  readonly themeId: string;
  readonly colorScheme: 'light' | 'dark' | 'system';
  readonly density: 'compact' | 'comfortable';
}

export interface ViewAccessibilityPreferences {
  readonly reduceMotion: boolean;
  readonly highContrast: boolean;
  readonly screenReaderOptimized: boolean;
}

export interface ViewHostContext {
  readonly session: HostSession;
  readonly focus: ViewFocusBoundary;
  readonly keyboard: ViewKeyboardBoundary;
  readonly sizing: ViewSizingPolicy;
  readonly chromeTheme: ViewChromeTheme;
  readonly accessibility: ViewAccessibilityPreferences;
  readonly capabilities: HostCapabilityLookup;
  readonly diagnostics: HostDiagnosticsSink;
}
