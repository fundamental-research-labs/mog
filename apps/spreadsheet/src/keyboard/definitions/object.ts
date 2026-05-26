/**
 * Object Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for floating objects (charts, images, shapes, TextEffect, Diagram):
 * - Delete/Deselect objects
 * - Nudge objects
 * - Duplicate objects
 * - Chart-specific operations
 * - Z-order commands
 * - TextEffect operations
 * - Diagram node operations
 *
 * Total: 28 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { altBinding, crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const OBJECT_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Basic Object Operations
  // ===========================================================================

  {
    id: 'delete-object',
    bindings: universalBinding('Delete'),
    description: 'Delete selected object(s)',
    action: 'DELETE_OBJECT',
    enabled: true,
    priority: 'critical',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'delete-object-backspace',
    bindings: universalBinding('Backspace'),
    description: 'Delete selected object(s)',
    action: 'DELETE_OBJECT',
    enabled: true,
    priority: 'critical',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'deselect-object',
    bindings: universalBinding('Escape'),
    description: 'Deselect object',
    action: 'DESELECT_OBJECT',
    enabled: true,
    priority: 'critical',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },

  // ===========================================================================
  // Nudge Objects
  // ===========================================================================

  {
    id: 'nudge-object-up',
    bindings: universalBinding('ArrowUp'),
    description: 'Nudge object up',
    action: 'NUDGE_OBJECT_UP',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'nudge-object-down',
    bindings: universalBinding('ArrowDown'),
    description: 'Nudge object down',
    action: 'NUDGE_OBJECT_DOWN',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'nudge-object-left',
    bindings: universalBinding('ArrowLeft'),
    description: 'Nudge object left',
    action: 'NUDGE_OBJECT_LEFT',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'nudge-object-right',
    bindings: universalBinding('ArrowRight'),
    description: 'Nudge object right',
    action: 'NUDGE_OBJECT_RIGHT',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'nudge-object-up-fine',
    bindings: universalBinding('ArrowUp', 'shift'),
    description: 'Nudge object up (fine)',
    action: 'NUDGE_OBJECT_UP_FINE',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'nudge-object-down-fine',
    bindings: universalBinding('ArrowDown', 'shift'),
    description: 'Nudge object down (fine)',
    action: 'NUDGE_OBJECT_DOWN_FINE',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'nudge-object-left-fine',
    bindings: universalBinding('ArrowLeft', 'shift'),
    description: 'Nudge object left (fine)',
    action: 'NUDGE_OBJECT_LEFT_FINE',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'nudge-object-right-fine',
    bindings: universalBinding('ArrowRight', 'shift'),
    description: 'Nudge object right (fine)',
    action: 'NUDGE_OBJECT_RIGHT_FINE',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Duplicate
  // ===========================================================================

  {
    id: 'duplicate-object',
    bindings: crossPlatformBinding('KeyD', 'ctrl'),
    description: 'Duplicate object',
    action: 'DUPLICATE_OBJECT',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'd',
  },

  // ===========================================================================
  // Chart-specific shortcuts
  // ===========================================================================

  {
    id: 'edit-chart',
    bindings: universalBinding('Enter'),
    description: 'Edit selected chart (open chart editor)',
    action: 'EDIT_CHART',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Opens chart editor when a chart is selected',
  },
  {
    id: 'edit-chart-title',
    bindings: universalBinding('F2'),
    description: 'Edit chart title inline',
    action: 'EDIT_CHART_TITLE',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Starts inline editing of chart title when a chart is selected',
  },
  {
    id: 'create-embedded-chart',
    bindings: altBinding('F1'),
    description: 'Create embedded chart from selection',
    action: 'CREATE_EMBEDDED_CHART',
    enabled: true,
    priority: 'low',
    category: 'object',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Alt+F1 creates embedded chart on current sheet',
  },

  // ===========================================================================
  // Chart Z-Order
  // ===========================================================================

  {
    id: 'bring-chart-to-front',
    // Ctrl+Shift+] - BracketRight with Shift
    bindings: crossPlatformBinding('BracketRight', 'ctrl', 'shift'),
    description: 'Bring chart to front',
    action: 'BRING_CHART_TO_FRONT',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Brings selected chart to the front (highest z-index)',
  },
  {
    id: 'send-chart-to-back',
    // Ctrl+Shift+[ - BracketLeft with Shift
    bindings: crossPlatformBinding('BracketLeft', 'ctrl', 'shift'),
    description: 'Send chart to back',
    action: 'SEND_CHART_TO_BACK',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Sends selected chart to the back (lowest z-index)',
  },
  {
    id: 'bring-chart-forward',
    // Alt+Shift+] - BracketRight with Alt+Shift
    bindings: altBinding('BracketRight', 'shift'),
    description: 'Bring chart forward one layer',
    action: 'BRING_CHART_FORWARD',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Brings selected chart forward by one layer in z-order',
  },
  {
    id: 'send-chart-backward',
    // Alt+Shift+[ - BracketLeft with Alt+Shift
    bindings: altBinding('BracketLeft', 'shift'),
    description: 'Send chart backward one layer',
    action: 'SEND_CHART_BACKWARD',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Sends selected chart backward by one layer in z-order',
  },

  // ===========================================================================
  // TextEffect-specific shortcuts
  // ===========================================================================

  {
    id: 'open-text-effects-gallery',
    // unified keytip router: real `Alt+N,KeyW` chord. The bare
    // `Alt+N` stub that used to live here pre-empted the Insert
    // ribbon-tab switch (`ribbon.switch-insert`); the chord variant
    // below leaves Alt+N free for the tab-switch and only fires
    // OPEN_TEXT_EFFECT_GALLERY after the KeyW follow-on.
    bindings: altBinding('KeyN'),
    sequence: ['KeyW'],
    description: 'Insert text effects (Alt+N,W)',
    action: 'OPEN_TEXT_EFFECT_GALLERY',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Compatibility keytip: Insert → W opens the text effects gallery.',
  },
  {
    id: 'edit-text-effects-text',
    bindings: universalBinding('Enter'),
    description: 'Edit text effects text',
    action: 'EDIT_TEXT_EFFECT_TEXT',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes:
      'Starts inline text editing when a TextEffect object is selected. Same behavior as chart Enter key.',
  },
  {
    id: 'cancel-text-effects-edit',
    bindings: universalBinding('Escape'),
    description: 'Cancel text effects edit',
    action: 'CANCEL_TEXT_EFFECT_EDIT',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['editing'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes: 'Cancels text effects editing without committing changes. Returns to selection mode.',
  },

  // ===========================================================================
  // Diagram-specific shortcuts (node operations)
  // ===========================================================================

  {
    id: 'diagram-demote-node',
    bindings: universalBinding('Tab'),
    description: 'Demote diagram item (increase level)',
    action: 'DIAGRAM_DEMOTE_NODE',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['diagramNodeSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes:
      'Diagram: Demotes selected item to become a child of its previous sibling. Only active when a diagram item is selected.',
  },
  {
    id: 'diagram-promote-node',
    bindings: universalBinding('Tab', 'shift'),
    description: 'Promote diagram item (decrease level)',
    action: 'DIAGRAM_PROMOTE_NODE',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['diagramNodeSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes:
      'Diagram: Promotes selected item to become a sibling of its parent. Only active when a diagram item is selected.',
  },
  {
    id: 'diagram-remove-node',
    bindings: universalBinding('Delete'),
    description: 'Remove diagram item',
    action: 'DIAGRAM_REMOVE_NODE',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['diagramNodeSelected'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes:
      "Diagram: Removes the selected item from the diagram. Children are promoted to the removed item's parent.",
  },
  {
    id: 'diagram-remove-node-backspace',
    bindings: universalBinding('Backspace'),
    description: 'Remove diagram item',
    action: 'DIAGRAM_REMOVE_NODE',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['diagramNodeSelected'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes:
      "Diagram: Removes the selected item from the diagram (alternative key). Children are promoted to the removed item's parent.",
  },
  {
    id: 'diagram-add-node',
    bindings: universalBinding('Enter'),
    description: 'Add new diagram item after current',
    action: 'DIAGRAM_ADD_NODE',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['diagramNodeSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Diagram: Adds a new item after the currently selected item at the same level.',
  },
  {
    id: 'diagram-deselect-node',
    bindings: universalBinding('Escape'),
    description: 'Deselect diagram item',
    action: 'DIAGRAM_DESELECT_NODE',
    enabled: true,
    priority: 'high',
    category: 'object',
    contexts: ['diagramNodeSelected'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes:
      'Diagram: Deselects the current item. If editing, stops editing. Returns to diagram object selection.',
  },
];
