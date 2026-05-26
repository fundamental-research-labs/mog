/**
 * Diagram Selectors
 *
 * Helper functions for querying Diagram objects from sheet data.
 * These selectors operate on a Sheet snapshot (deserialized view).
 *
 * @see ../floating-objects.ts for DiagramObject definition
 */

import type { FloatingObject, DiagramObject } from '@mog/types-objects/objects/floating-objects';

/**
 * Minimal Sheet interface for selector functions.
 *
 * This represents the deserialized view of sheet data used by selectors.
 * The floatingObjects array is the deserialized form of the Y.Map storage.
 */
export interface Sheet {
  /** Array of floating objects on the sheet (deserialized from Y.Map) */
  floatingObjects?: FloatingObject[];
}

/**
 * Selectors for querying Diagram objects.
 *
 * These selectors follow the same pattern as other floating object selectors,
 * providing type-safe access to Diagram objects from sheet data.
 */
export const diagramSelectors = {
  /**
   * Get a Diagram object by ID.
   *
   * @param sheet The sheet to search in
   * @param id The Diagram object ID
   * @returns The Diagram object if found, undefined otherwise
   */
  getDiagramById(sheet: Sheet, id: string): DiagramObject | undefined {
    const obj = sheet.floatingObjects?.find((obj) => obj.id === id);
    return obj?.type === 'diagram' ? (obj as DiagramObject) : undefined;
  },

  /**
   * Get the first Diagram object on a sheet.
   *
   * Note: Position-based lookup (by row/col) is not possible at the selector level
   * because FloatingObject positions use CellId-based anchors (Cell Identity Model).
   * Resolving CellIds to positions requires CellPositionLookup from the bridge layer.
   *
   * For proper position-based hit testing, use the
   * IFloatingObjectManager.getObjectsOverlappingRange() method which has access
   * to the cell position lookup.
   *
   * @param sheet The sheet to search in
   * @returns The first Diagram object found, or undefined if none exist
   */
  getFirstDiagram(sheet: Sheet): DiagramObject | undefined {
    return sheet.floatingObjects?.find((obj): obj is DiagramObject => obj.type === 'diagram');
  },

  /**
   * Get all Diagram objects on a sheet.
   *
   * @param sheet The sheet to search in
   * @returns Array of all Diagram objects (empty array if none)
   */
  getAllDiagrams(sheet: Sheet): DiagramObject[] {
    return (
      sheet.floatingObjects?.filter((obj): obj is DiagramObject => obj.type === 'diagram') || []
    );
  },
};
