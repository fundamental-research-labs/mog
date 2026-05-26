/**
 * Conditional Formatting Events
 *
 * Event types for CF rule operations.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface CFRulesChangedEvent extends BaseEvent {
  type: 'cf:rules-changed';
  sheetId: string;
  ruleCount: number;
  addedRuleIds?: string[];
  removedRuleIds?: string[];
  updatedRuleIds?: string[];
  source: StructureChangeSource;
}

export interface CFRuleCreatedEvent extends BaseEvent {
  type: 'cf:rule-created';
  sheetId: string;
  formatId: string;
  ruleId: string;
  ruleType: string;
  source: StructureChangeSource;
}

export interface CFRuleDeletedEvent extends BaseEvent {
  type: 'cf:rule-deleted';
  sheetId: string;
  formatId: string;
  ruleId?: string;
  source: StructureChangeSource;
}

export interface CFRuleUpdatedEvent extends BaseEvent {
  type: 'cf:rule-updated';
  sheetId: string;
  formatId: string;
  ruleId: string;
  updatedFields: string[];
  source: StructureChangeSource;
}

export type ConditionalFormattingEvent =
  | CFRulesChangedEvent
  | CFRuleCreatedEvent
  | CFRuleDeletedEvent
  | CFRuleUpdatedEvent;
