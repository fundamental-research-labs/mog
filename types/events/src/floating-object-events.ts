/**
 * Floating Object Events
 *
 * Event types for images, shapes, drawings.
 *
 * Transition note: All event types now carry both `sheetId` (legacy) and
 * `containerId` (universal). During the migration, both are set to the same
 * value. `sheetId` will be removed in a follow-up migration once all consumers
 * have migrated to `containerId`.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type {
  FloatingObject,
  FloatingObjectGroup,
  FloatingObjectKind,
  ObjectPosition,
} from '@mog/types-objects/objects/floating-objects';

export interface FloatingObjectCreatedEvent extends BaseEvent {
  type: 'floatingObject:created';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
  objectType?: FloatingObjectKind;
  source: StructureChangeSource;
  /** Full object payload for the newly created object */
  data?: FloatingObject;
  /** Resolved pixel bounds from Rust (position + size + rotation) */
  bounds?: { x: number; y: number; width: number; height: number; rotation: number };
}

export interface FloatingObjectUpdatedEvent extends BaseEvent {
  type: 'floatingObject:updated';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
  changes: Partial<FloatingObject>;
  source: StructureChangeSource;
  /** Optional full object payload — when present, consumers can skip re-reading from Rust */
  data?: FloatingObject;
  /** Resolved pixel bounds from Rust (position + size + rotation) */
  bounds?: { x: number; y: number; width: number; height: number; rotation: number };
  /** Names of the fields that changed — useful for targeted invalidation */
  changedFields?: string[];
}

export interface FloatingObjectDeletedEvent extends BaseEvent {
  type: 'floatingObject:deleted';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
  objectType: FloatingObjectKind;
  source: StructureChangeSource;
  /** Optional deleted object snapshot for undo support */
  data?: FloatingObject;
}

export interface FloatingObjectMovedEvent extends BaseEvent {
  type: 'floatingObject:moved';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
  oldPosition: ObjectPosition;
  newPosition: ObjectPosition;
  source: StructureChangeSource;
}

export interface FloatingObjectResizedEvent extends BaseEvent {
  type: 'floatingObject:resized';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
  oldSize: { width: number; height: number };
  newSize: { width: number; height: number };
  source: StructureChangeSource;
}

export interface FloatingObjectRotatedEvent extends BaseEvent {
  type: 'floatingObject:rotated';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
  oldRotation: number;
  newRotation: number;
  source: StructureChangeSource;
}

export interface FloatingObjectZOrderChangedEvent extends BaseEvent {
  type: 'floatingObject:zOrderChanged';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
  oldZIndex: number;
  newZIndex: number;
  source: StructureChangeSource;
}

export interface FloatingObjectsGroupedEvent extends BaseEvent {
  type: 'floatingObject:grouped';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  groupId: string;
  memberIds: string[];
  source: StructureChangeSource;
}

export interface FloatingObjectsUngroupedEvent extends BaseEvent {
  type: 'floatingObject:ungrouped';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  groupId: string;
  memberIds: string[];
  source: StructureChangeSource;
}

export interface FloatingObjectSelectionChangedEvent extends BaseEvent {
  type: 'floatingObject:selectionChanged';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  userId?: string;
  oldSelectedIds: string[];
  newSelectedIds: string[];
}

export interface FloatingObjectGroupUpdatedEvent extends BaseEvent {
  type: 'floatingObjectGroup:updated';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  groupId: string;
  source: StructureChangeSource;
  /** Optional full group payload — when present, consumers can skip re-reading from Rust */
  data?: FloatingObjectGroup;
}

export interface FloatingObjectGroupDeletedEvent extends BaseEvent {
  type: 'floatingObjectGroup:deleted';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  groupId: string;
  source: StructureChangeSource;
  /** Optional deleted group snapshot for undo support */
  data?: FloatingObjectGroup;
}

/**
 * Fired when an object transitions from idle to selected or editing state.
 * M7: onActivated from OfficeJS audit.
 *
 * NOTE: XState machine wiring is a separate step — the event type is defined
 * here so consumers can subscribe, and the ObjectSystem (or equivalent) is
 * responsible for emitting it on state transitions.
 */
export interface FloatingObjectActivatedEvent extends BaseEvent {
  type: 'floatingObject:activated';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
}

/**
 * Fired when an object transitions from selected/editing back to idle.
 * M8: onDeactivated from OfficeJS audit.
 *
 * NOTE: XState machine wiring is a separate step — see FloatingObjectActivatedEvent.
 */
export interface FloatingObjectDeactivatedEvent extends BaseEvent {
  type: 'floatingObject:deactivated';
  sheetId: string;
  /** Container scope (same as sheetId during transition) */
  containerId: string;
  objectId: string;
}

export type FloatingObjectEvent =
  | FloatingObjectCreatedEvent
  | FloatingObjectUpdatedEvent
  | FloatingObjectDeletedEvent
  | FloatingObjectMovedEvent
  | FloatingObjectResizedEvent
  | FloatingObjectRotatedEvent
  | FloatingObjectZOrderChangedEvent
  | FloatingObjectsGroupedEvent
  | FloatingObjectsUngroupedEvent
  | FloatingObjectSelectionChangedEvent
  | FloatingObjectGroupUpdatedEvent
  | FloatingObjectGroupDeletedEvent
  | FloatingObjectActivatedEvent
  | FloatingObjectDeactivatedEvent;
