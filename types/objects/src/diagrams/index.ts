/**
 * Diagram Module
 *
 * Barrel export for Diagram types, layouts, and styles.
 * This module provides all the type definitions needed for Diagram diagrams.
 *
 * @see types.ts - Core Diagram types (nodes, diagrams, computed layout)
 * @see layouts.ts - Layout definitions and algorithms (legacy)
 * @see styles.ts - Quick styles and color themes
 * @see ooxml-data-model-types.ts - OOXML data model types (points, connections, rich text)
 * @see ooxml-layout-types.ts - OOXML layout definition types (layout nodes, algorithms, shapes)
 * @see ooxml-drawing-types.ts - OOXML drawing cache types (pre-rendered shapes)
 * @see ooxml-algorithm-types.ts - OOXML algorithm parameter types (55 ST_ParameterId values)
 * @see ooxml-engine-types.ts - OOXML constraint, iteration, and variable types
 * @see ooxml-style-types.ts - OOXML style label types (colors, styles)
 */

export * from './layouts';
export * from './ooxml-algorithm-types';
export * from './ooxml-data-model-types';
export * from './ooxml-drawing-types';
export * from './ooxml-engine-types';
export * from './ooxml-layout-types';
export * from './ooxml-style-types';
export * from './styles';
export * from './types';
