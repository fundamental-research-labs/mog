import { KernelError } from '../../errors';
import type { SourceConfig, TableBinding, TableId } from './connection';

/**
 * Serialized format for table bindings (stored in workbook file)
 */
export interface SerializedBindings {
  version: 1;
  bindings: SerializedBinding[];
}

export interface SerializedBinding {
  tableId: string;
  connectionId: string;
  sourceConfig: SourceConfig;
}

/**
 * Serialize bindings for storage in workbook file
 */
export function serializeBindings(bindings: TableBinding[]): SerializedBindings {
  return {
    version: 1,
    bindings: bindings.map((b) => ({
      tableId: String(b.tableId),
      connectionId: b.connectionId,
      sourceConfig: b.sourceConfig,
    })),
  };
}

/**
 * Deserialize bindings from workbook file
 */
export function deserializeBindings(data: SerializedBindings): TableBinding[] {
  if (data.version !== 1) {
    throw new KernelError('OPERATION_FAILED', `Unknown bindings version: ${data.version}`);
  }

  return data.bindings.map((b) => ({
    tableId: b.tableId as TableId,
    connectionId: b.connectionId,
    sourceConfig: b.sourceConfig,
  }));
}

/**
 * Validate a binding configuration
 */
export function validateBinding(binding: TableBinding): string[] {
  const errors: string[] = [];

  if (!binding.tableId) {
    errors.push('tableId is required');
  }

  if (!binding.connectionId) {
    errors.push('connectionId is required');
  }

  if (!binding.sourceConfig) {
    errors.push('sourceConfig is required');
  } else {
    switch (binding.sourceConfig.type) {
      case 'table':
        if (!binding.sourceConfig.tableName) {
          errors.push('tableName is required for table source');
        }
        break;
      case 'endpoint':
        if (!binding.sourceConfig.path) {
          errors.push('path is required for endpoint source');
        }
        break;
      case 'query':
        if (!binding.sourceConfig.queryName) {
          errors.push('queryName is required for query source');
        }
        break;
      case 'local':
        // No additional validation needed
        break;
      default:
        errors.push(`Unknown source type`);
    }
  }

  return errors;
}
