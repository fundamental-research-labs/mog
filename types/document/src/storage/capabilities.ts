/**
 * Table Driver Capabilities
 *
 * Capability flags that describe what a table driver can and cannot do.
 * Apps can check these to enable/disable features based on the data source.
 *
 */

// =============================================================================
// Capabilities Interface
// =============================================================================

/**
 * Capability flags for a table driver.
 * Apps can check these to enable/disable features based on the data source.
 */
export interface TableDriverCapabilities {
  /** Can create new records? */
  canCreate: boolean;
  /** Can update existing records? */
  canUpdate: boolean;
  /** Can delete records? */
  canDelete: boolean;
  /** Supports real-time updates via subscribe()? */
  canStream: boolean;
  /** Is data stored locally in the workbook? */
  isLocal: boolean;
  /** Supports atomic transactions? */
  supportsTransactions: boolean;
  /** Has executeNative() for raw queries? */
  supportsNativeQuery: boolean;
  /** Has batch operations (createRecords, updateRecords, deleteRecords)? */
  supportsBatch: boolean;
  /** Has subscribe() for real-time change notifications? */
  supportsWatch: boolean;
}
