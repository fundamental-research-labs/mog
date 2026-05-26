/**
 * KeyTips System
 *
 * Barrel export for the KeyTips system.
 * Provides Alt-key navigation for the ribbon toolbar.
 *
 */

// Context and provider
export { KeyTipProvider, useKeyTips } from './KeyTipContext';

// Overlay component
export { KeyTipOverlay } from './KeyTipOverlay';

// Registry
export { keyTipRegistry, useKeyTipRegistration } from './keytip-registry';

// Types
export type { KeyTipBadgePosition, KeyTipEntry, KeyTipMode } from './types';
