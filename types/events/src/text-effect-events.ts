/**
 * TextEffect Event Types
 *
 * Event definitions for TextEffect state changes. These events enable
 * reactive coordination between components and support undo/redo operations.
 *
 * Event Design Principles:
 * - All events extend BaseEvent for consistent structure
 * - Include previous state where applicable (for undo support)
 * - Include relevant IDs for targeted handling
 * - Follow the same patterns as ink-events.ts
 *
 * @see contracts/src/events/ink-events.ts for event patterns
 * @see contracts/src/text-effects/types.ts for type definitions
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type {
  TextEffectConfig,
  TextEffectConfigUpdate,
} from '@mog/types-objects/text-effects/types';

// =============================================================================
// TextEffect Lifecycle Events
// =============================================================================

/**
 * Emitted when a new TextEffect object is created.
 *
 * This event fires when a user creates a new TextEffect text box through
 * the Insert menu, ribbon, or programmatic API. It includes the full
 * initial configuration for the TextEffect.
 *
 * @example
 * eventBus.on('textEffectsCreated', (event) => {
 *   console.log(`TextEffect created: ${event.payload.objectId}`);
 *   console.log(`Preset: ${event.payload.config.warpPreset}`);
 * });
 */
export interface TextEffectCreatedEvent extends BaseEvent {
  type: 'textEffectsCreated';
  payload: {
    /** Unique identifier for the TextEffect object */
    objectId: string;
    /** Sheet containing the TextEffect */
    sheetId: string;
    /** Complete TextEffect configuration */
    config: TextEffectConfig;
  };
  /** Source of the creation */
  source: StructureChangeSource;
}

/**
 * Emitted when a TextEffect object's configuration is updated.
 *
 * This event fires when any part of the TextEffect configuration changes,
 * including warp preset, fill, outline, effects, or adjustments.
 * Both the changes and the previous state are included to support undo.
 *
 * @example
 * eventBus.on('textEffectsUpdated', (event) => {
 *   if (event.payload.changes.warpPreset) {
 *     console.log(`Warp changed from ${event.payload.previousConfig.warpPreset} to ${event.payload.changes.warpPreset}`);
 *   }
 * });
 */
export interface TextEffectUpdatedEvent extends BaseEvent {
  type: 'textEffectsUpdated';
  payload: {
    /** Unique identifier for the TextEffect object */
    objectId: string;
    /** Sheet containing the TextEffect */
    sheetId: string;
    /** Partial config containing only the changed properties */
    changes: TextEffectConfigUpdate;
    /** Complete previous configuration (for undo support) */
    previousConfig: TextEffectConfig;
  };
  /** Source of the update */
  source: StructureChangeSource;
}

/**
 * Emitted when TextEffect styling is removed from a text box.
 *
 * This event fires when a user removes all TextEffect styling from a text box,
 * converting it back to a plain text box. The text content is preserved,
 * but all warp, fill, outline, and effects are removed.
 *
 * @example
 * eventBus.on('textEffectsRemoved', (event) => {
 *   // Store previous config for undo
 *   undoStack.push({
 *     type: 'restore-text-effects',
 *     objectId: event.payload.objectId,
 *     config: event.payload.previousConfig
 *   });
 * });
 */
export interface TextEffectRemovedEvent extends BaseEvent {
  type: 'textEffectsRemoved';
  payload: {
    /** Unique identifier for the text box object */
    objectId: string;
    /** Sheet containing the text box */
    sheetId: string;
    /** Complete previous TextEffect configuration (for undo support) */
    previousConfig: TextEffectConfig;
  };
  /** Source of the removal */
  source: StructureChangeSource;
}

/**
 * Emitted when a plain text box is converted to TextEffect.
 *
 * This event fires when a user applies TextEffect styling to an existing
 * text box. This is distinct from TextEffectCreatedEvent which fires for
 * new TextEffect objects created from scratch.
 *
 * @example
 * eventBus.on('textEffectsConverted', (event) => {
 *   console.log(`TextBox ${event.payload.objectId} converted to TextEffect`);
 *   console.log(`Using preset: ${event.payload.config.warpPreset}`);
 * });
 */
export interface TextEffectConvertedEvent extends BaseEvent {
  type: 'textEffectsConverted';
  payload: {
    /** Unique identifier for the text box object */
    objectId: string;
    /** Sheet containing the text box */
    sheetId: string;
    /** TextEffect configuration applied to the text box */
    config: TextEffectConfig;
  };
  /** Source of the conversion */
  source: StructureChangeSource;
}

// =============================================================================
// Union Type for All TextEffect Events
// =============================================================================

/**
 * Union of all TextEffect-related events.
 *
 * Use this type when subscribing to all TextEffect events or when
 * implementing event handlers that need to process any TextEffect event.
 *
 * @example
 * function handleTextEffectEvent(event: TextEffectEvent) {
 *   switch (event.type) {
 *     case 'textEffectsCreated':
 *       // Handle creation
 *       break;
 *     case 'textEffectsUpdated':
 *       // Handle update
 *       break;
 *     case 'textEffectsRemoved':
 *       // Handle removal
 *       break;
 *     case 'textEffectsConverted':
 *       // Handle conversion
 *       break;
 *   }
 * }
 */
export type TextEffectEvent =
  | TextEffectCreatedEvent
  | TextEffectUpdatedEvent
  | TextEffectRemovedEvent
  | TextEffectConvertedEvent;

// =============================================================================
// Event Type Literal Union
// =============================================================================

/**
 * All TextEffect event type strings.
 *
 * Use this type for type-safe event type checking or when
 * registering event listeners by type string.
 *
 * @example
 * const eventType: TextEffectEventType = 'textEffectsCreated';
 *
 * @example
 * function isTextEffectEvent(type: string): type is TextEffectEventType {
 *   return ['textEffectsCreated', 'textEffectsUpdated', 'textEffectsRemoved', 'textEffectsConverted'].includes(type);
 * }
 */
export type TextEffectEventType = TextEffectEvent['type'];
