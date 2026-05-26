/**
 * Record Detail Sidebar Component
 *
 * Right sidebar for viewing and editing record details.
 * Appears when user clicks a row/card/item in any view.
 *
 * Design:
 * - Fixed width (400px) sidebar on the right
 * - Shows all fields for a single record
 * - Inline editing of field values
 * - Managed by recordDetail state in RecordDetailSlice
 *
 * State:
 * - recordDetail: { tableId, rowId } | null
 * - Opens when view calls uiStore.openRecordDetail()
 * - Closes via X button or clicking outside
 *
 * Future enhancements:
 * - Activity timeline
 * - Related records
 * - Comments
 * - Attachments
 */

import { useShellStore } from '../infra/context';

/**
 * Record detail sidebar.
 * Shows detailed view of a single record with all fields.
 */
export function RecordDetailSidebar() {
  const recordDetail = useShellStore((s) => s.recordDetail);
  const closeRecordDetail = useShellStore((s) => s.closeRecordDetail);

  if (!recordDetail) return null;

  return (
    <div className="w-[400px] border-l bg-ss-surface flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold text-section">Record Detail</h2>
        <button
          onClick={closeRecordDetail}
          className="text-ss-text-secondary hover:text-ss-text transition-colors p-1"
          aria-label="Close record detail"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* TODO: Load and render record fields using Workbook API */}
        <div className="space-y-4">
          <div className="text-body-sm text-ss-text-secondary">
            <div>
              <span className="font-medium">Table:</span> {recordDetail.tableId}
            </div>
            <div className="mt-1">
              <span className="font-medium">Row:</span> {recordDetail.rowId}
            </div>
          </div>
          <div className="border-t pt-4">
            <p className="text-body-sm text-ss-text-secondary">
              Record fields will be displayed here once integrated with Workbook API.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
