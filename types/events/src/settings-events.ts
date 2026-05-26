/**
 * Settings Events
 *
 * Event types for workbook/sheet settings and theme changes.
 */

import type {
  PolicyPreservedParseOutcome,
  PolicyPreservedParseSummary,
  PrintSettings,
  SheetSettings,
  WorkbookSettings,
} from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { ThemeDefinition } from '@mog/types-formatting/formatting/theme';
import type { ChromeTheme } from '@mog/types-viewport/rendering/data-source-types';

export interface WorkbookSettingsChangedEvent extends BaseEvent {
  type: 'workbook:settings-changed';
  settings: WorkbookSettings;
  changedKey: keyof WorkbookSettings;
  source: StructureChangeSource;
}

export interface SheetSettingsChangedEvent extends BaseEvent {
  type: 'sheet:settings-changed';
  sheetId: string;
  settings: SheetSettings;
  changedKey: keyof SheetSettings;
  source: StructureChangeSource;
}

export interface SheetPrintSettingsChangedEvent extends BaseEvent {
  type: 'sheet:print-settings-changed';
  sheetId: string;
  settings: PrintSettings;
  source: StructureChangeSource;
}

export interface WorkbookThemeChangedEvent extends BaseEvent {
  type: 'workbook:theme-changed';
  oldThemeId: string | undefined;
  newThemeId: string;
  customTheme?: ThemeDefinition;
  source: StructureChangeSource;
}

export interface ChromeThemeChangedEvent extends BaseEvent {
  type: 'chrome:theme-changed';
  chromeTheme: ChromeTheme;
}

export interface WorkbookPolicyPreservedEvent extends BaseEvent {
  type: 'workbook:policy-preserved';
  outcomes: PolicyPreservedParseOutcome[];
  summary: PolicyPreservedParseSummary;
  source: StructureChangeSource;
}

export type SettingsEvent =
  | WorkbookSettingsChangedEvent
  | SheetSettingsChangedEvent
  | SheetPrintSettingsChangedEvent
  | WorkbookThemeChangedEvent
  | ChromeThemeChangedEvent
  | WorkbookPolicyPreservedEvent;
