/**
 * Interactive Elements Capability Implementation
 *
 * Wraps gridRenderer.getInteractiveElementCollector() to provide the
 * ISheetViewInteractiveElements capability interface.
 *
 * @module @mog-sdk/sheet-view/capabilities/interactive-elements
 */

import type {
  CheckboxMetadata,
  CommentIndicatorMetadata,
  FilterButtonMetadata,
  GridRenderer,
  InteractiveElement,
  ValidationDropdownMetadata,
} from '@mog-sdk/contracts/rendering';

import type { ISheetViewInteractiveElements } from '../capability-interfaces';
import type {
  InteractiveElementInfo,
  InteractiveElementSnapshot,
  InteractiveElementType,
  SheetDisposable,
} from '../public-types';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface InteractiveElementsInternals {
  getRenderer(): GridRenderer;
}

// =============================================================================
// Implementation
// =============================================================================

function mapBounds(el: InteractiveElement) {
  return { x: el.bounds.x, y: el.bounds.y, width: el.bounds.width, height: el.bounds.height };
}

function mapElement(el: InteractiveElement): InteractiveElementInfo {
  const bounds = mapBounds(el);
  switch (el.type) {
    case 'filter-button': {
      const m = el.metadata as FilterButtonMetadata;
      return {
        id: el.id,
        type: 'filter-button',
        bounds,
        metadata: {
          type: 'filter-button',
          filterId: m.filterId,
          headerCellId: m.headerCellId,
          hasActiveFilter: m.hasActiveFilter,
          col: m.col,
        },
      };
    }
    case 'checkbox': {
      const m = el.metadata as CheckboxMetadata;
      return {
        id: el.id,
        type: 'checkbox',
        bounds,
        metadata: {
          type: 'checkbox',
          cellId: m.cellId,
          sheetId: m.sheetId,
          checked: m.checked,
          row: m.row,
          col: m.col,
        },
      };
    }
    case 'comment-indicator': {
      const m = el.metadata as CommentIndicatorMetadata;
      return {
        id: el.id,
        type: 'comment-indicator',
        bounds,
        metadata: {
          type: 'comment-indicator',
          cellId: m.cellId,
          sheetId: m.sheetId,
          row: m.row,
          col: m.col,
        },
      };
    }
    case 'validation-dropdown': {
      const m = el.metadata as ValidationDropdownMetadata;
      return {
        id: el.id,
        type: 'validation-dropdown',
        bounds,
        metadata: {
          type: 'validation-dropdown',
          cellId: m.cellId,
          sheetId: m.sheetId,
          row: m.row,
          col: m.col,
          options: m.options,
        },
      };
    }
    default:
      return {
        id: el.id,
        type: el.type as Exclude<
          InteractiveElementType,
          'filter-button' | 'checkbox' | 'comment-indicator' | 'validation-dropdown'
        >,
        bounds,
        metadata: el.metadata as unknown as Record<string, unknown>,
      };
  }
}

export class SheetViewInteractiveElements implements ISheetViewInteractiveElements {
  constructor(private readonly _internals: InteractiveElementsInternals) {}

  getSnapshot(): InteractiveElementSnapshot {
    const renderer = this._internals.getRenderer();
    const collector = renderer.getInteractiveElementCollector();
    return { elements: collector.getAll().map(mapElement) };
  }

  observe(listener: (snapshot: InteractiveElementSnapshot) => void): SheetDisposable {
    const renderer = this._internals.getRenderer();
    const collector = renderer.getInteractiveElementCollector();
    const unsubscribe = collector.subscribe((elements) => {
      listener({ elements: elements.map(mapElement) });
    });
    return { dispose: unsubscribe };
  }
}
