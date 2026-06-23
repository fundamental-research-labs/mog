import type { BridgeMethodKind } from './manifest.gen';

export interface VersionClassificationRequiredInventoryEntry {
  readonly source: string;
  readonly wrapper: string;
  readonly command: string;
  readonly method?: string;
  readonly access?: BridgeMethodKind;
}

export const REQUIRED_STRUCTURAL_SESSION_WRITE_OPERATIONS: readonly VersionClassificationRequiredInventoryEntry[] =
  [
    {
      source: 'compute-core-direct',
      wrapper: 'mutatePublic',
      command: 'compute_structure_change',
    },
    {
      source: 'generated-bridge',
      method: 'registerViewport',
      access: 'lifecycle',
      wrapper: 'mutateSystem',
      command: 'compute_register_viewport',
    },
    {
      source: 'generated-bridge',
      method: 'updateViewportBounds',
      access: 'write',
      wrapper: 'mutatePublic',
      command: 'compute_update_viewport_bounds',
    },
    {
      source: 'generated-bridge',
      method: 'unregisterViewport',
      access: 'lifecycle',
      wrapper: 'mutateSystem',
      command: 'compute_unregister_viewport',
    },
    {
      source: 'generated-bridge',
      method: 'resetSheetViewports',
      access: 'write',
      wrapper: 'mutatePublic',
      command: 'compute_reset_sheet_viewports',
    },
  ];
