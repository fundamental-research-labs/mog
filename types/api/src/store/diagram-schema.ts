/**
 * Diagram Schema - Type Definitions Only
 *
 * Runtime schema objects, defaults, and utility functions have been moved to:
 * @see @mog-sdk/kernel/defaults/diagram
 *
 * This file retains only the type exports for the contracts layer.
 */

/**
 * Type for Diagram node schema field names.
 */
export type DiagramNodeField =
  | 'id'
  | 'text'
  | 'level'
  | 'parentId'
  | 'childIds'
  | 'siblingOrder'
  | 'fillColor'
  | 'borderColor'
  | 'textColor'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'imageUrl'
  | 'imageFit';

/**
 * Type for Diagram diagram schema field names.
 */
export type DiagramField =
  | 'layoutId'
  | 'category'
  | 'nodeMap'
  | 'rootNodeIds'
  | 'quickStyleId'
  | 'colorThemeId'
  | 'layoutOptions';
