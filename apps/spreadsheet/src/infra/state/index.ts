/**
 * State Module - Barrel Export
 *
 * Exports for extension store and keyboard settings store.
 */

// Extension Store
export {
  selectActiveExtensionId,
  selectExtensionCount,
  selectExtensionState,
  selectIsExtensionReady,
  selectIsResizing,
  selectPanelVisible,
  selectPanelWidth,
  useExtensionStore,
  type ExtensionStoreState,
} from './extension-store';

// Keyboard Settings Store
export {
  selectActiveProfileId,
  selectAllProfiles,
  selectProfileById,
  selectProfileIds,
  useKeyboardSettingsStore,
  type KeyboardSettingsState,
} from './keyboard-settings-store';
