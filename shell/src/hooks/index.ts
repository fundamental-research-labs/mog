/**
 * Shell Hooks
 */

export {
  useFileExplorerConfig,
  useOpenProjectDialog,
  type UseFileExplorerConfigOptions,
} from './use-file-explorer-config';
export { useNativeMenu } from './use-native-menu';
export { usePlatformInfo, type PlatformInfo } from './use-platform-info';
export { useTauriDropZone, type TauriDropZoneOptions } from './use-tauri-drop-zone';

export { useDocument, type UseDocumentResult } from './use-document';

// Capability System
export {
  CapabilityRequesterContext,
  useCapabilityRequester,
  useCapabilityRequesterContext,
  type UseCapabilityRequesterOptions,
  type UseCapabilityRequesterResult,
} from './use-capability-requester';

// App Kernel Hook (capability-gated API with hot-reload)
export { useAppKernel, type UseAppKernelDeps, type UseAppKernelResult } from './use-app-kernel';
