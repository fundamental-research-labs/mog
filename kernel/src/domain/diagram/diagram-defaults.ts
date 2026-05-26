/**
 * Diagram Schema Defaults - Re-export
 *
 * Re-exports from the diagram package, which owns the runtime defaults
 * to avoid circular dependency (kernel depends on diagram).
 *
 * Consumers that depend on kernel can import from '@mog-sdk/kernel'.
 * The diagram package itself imports from its own local defaults.
 */

export {
  DIAGRAM_DIAGRAM_SCHEMA,
  DIAGRAM_NODE_SCHEMA,
  getRequiredDiagramFields,
  getRequiredDiagramNodeFields,
  getDiagramDefault,
  getDiagramDefaults,
  getDiagramNodeDefault,
  getDiagramNodeDefaults,
  isDiagramFieldRequired,
  isDiagramNodeFieldRequired,
} from '@mog/diagram-engine/defaults';
