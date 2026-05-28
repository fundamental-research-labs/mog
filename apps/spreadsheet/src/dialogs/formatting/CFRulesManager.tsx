/**
 * CF Rules Manager Dialog
 *
 * Dialog for viewing, editing, deleting, and reordering conditional formatting rules.
 * Provides a list view of all CF rules for the current sheet or all sheets.
 *
 *
 *
 * Uses the Worksheet API for all CF operations.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  dispatch,
  useActionDependencies,
  useActiveSheetId,
  useIsRulesManagerOpen,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTable,
  DialogToolbar,
  EmptyState,
  Select,
} from '@mog/shell';
import type { CFRule, ConditionalFormat } from '@mog-sdk/contracts/conditional-format';
import type { SheetId } from '@mog-sdk/contracts/core';
import { CFRuleRow } from './CFRuleRow';

// =============================================================================
// Types
// =============================================================================

interface RuleWithFormat {
  format: ConditionalFormat;
  sheetId: SheetId;
  rule: CFRule;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Enhancement: Special filter values for sheet selection dropdown.
 * '_all' shows rules from all sheets, '_current' follows active sheet.
 */
const FILTER_ALL_SHEETS = '_all';
const FILTER_CURRENT_SHEET = '_current';

// =============================================================================
// Component
// =============================================================================

export function CFRulesManager() {
  const isOpen = useIsRulesManagerOpen();
  const closeRulesManager = useUIStore((s) => s.closeRulesManager);
  const openCFDialog = useUIStore((s) => s.openCFDialog);
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const actionDeps = useActionDependencies();

  /**
   * Enhancement: Per-sheet filter dropdown.
   * '_current' = follow active sheet, '_all' = all sheets, or a specific sheetId
   */
  const [sheetFilter, setSheetFilter] = useState<string>(FILTER_CURRENT_SHEET);
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);

  // Formats loaded via Worksheet API, paired with their source sheet ID
  const [sheetFormats, setSheetFormats] = useState<
    Array<{ format: ConditionalFormat; sheetId: SheetId }>
  >([]);
  const [loadVersion, setLoadVersion] = useState(0);
  const reload = useCallback(() => setLoadVersion((v) => v + 1), []);

  // Sheet name cache - populated synchronously via Workbook/Worksheet API
  const [sheetNameCache, setSheetNameCache] = useState<Record<string, string>>({});

  // Get sheet name helper (uses cached names)
  const getSheetName = useCallback(
    (sheetId: SheetId): string => {
      return sheetNameCache[sheetId] || sheetId;
    },
    [sheetNameCache],
  );

  /**
   * Enhancement: Get all sheet IDs and build dropdown options.
   * Lists each sheet individually for per-sheet filtering.
   * Uses unified Workbook/Worksheet API (all sync).
   */
  const [sheetFilterOptions, setSheetFilterOptions] = useState<
    Array<{ value: string; label: string }>
  >([
    { value: FILTER_CURRENT_SHEET, label: 'Current Sheet' },
    { value: FILTER_ALL_SHEETS, label: 'All Sheets' },
  ]);

  useEffect(() => {
    void (async () => {
      const nameMap: Record<string, string> = {};
      const options: Array<{ value: string; label: string }> = [];
      const ids: SheetId[] = [];

      const sheetCount = wb.sheetCount;
      for (let i = 0; i < sheetCount; i++) {
        const ws = await wb.getSheetByIndex(i);
        ids.push(ws.getSheetId());
      }
      // Get current sheet name
      let currentSheetLabel: string;
      try {
        currentSheetLabel = await wb.getSheetById(activeSheetId).getName();
      } catch {
        currentSheetLabel = activeSheetId;
      }
      nameMap[activeSheetId] = currentSheetLabel;

      options.push(
        { value: FILTER_CURRENT_SHEET, label: `Current Sheet (${currentSheetLabel})` },
        { value: FILTER_ALL_SHEETS, label: 'All Sheets' },
      );

      if (ids.length > 1) {
        options.push({ value: '', label: '──────────' });
        for (const sheetId of ids) {
          try {
            const ws = wb.getSheetById(sheetId);
            const sheetName = await ws.getName();
            nameMap[sheetId] = sheetName;
            if ((await ws.getVisibility()) === 'visible') {
              options.push({ value: sheetId, label: sheetName });
            }
          } catch {
            // Sheet not found — skip
          }
        }
      }

      setSheetNameCache(nameMap);
      setSheetFilterOptions(options);
    })();
  }, [wb, activeSheetId]);

  /**
   * Determine which sheet ID to filter by based on sheetFilter state.
   */
  const effectiveSheetId = useMemo(() => {
    if (sheetFilter === FILTER_CURRENT_SHEET) {
      return activeSheetId;
    }
    if (sheetFilter === FILTER_ALL_SHEETS) {
      return null; // null means show all
    }
    // Specific sheet selected
    return sheetFilter;
  }, [sheetFilter, activeSheetId]);

  // Load formats via Worksheet API
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    async function load() {
      const results: Array<{ format: ConditionalFormat; sheetId: SheetId }> = [];

      if (effectiveSheetId !== null) {
        // Single sheet
        try {
          const ws = wb.getSheetById(effectiveSheetId);
          const formats = await ws.conditionalFormats.list();
          for (const f of formats) {
            results.push({ format: f, sheetId: effectiveSheetId });
          }
        } catch {
          // Sheet may not exist
        }
      } else {
        // All sheets
        const sheetCount = wb.sheetCount;
        for (let i = 0; i < sheetCount; i++) {
          try {
            const ws = await wb.getSheetByIndex(i);
            const sid = ws.getSheetId();
            const formats = await ws.conditionalFormats.list();
            for (const f of formats) {
              results.push({ format: f, sheetId: sid });
            }
          } catch {
            // Skip failed sheets
          }
        }
      }

      if (!cancelled) {
        setSheetFormats(results);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [wb, effectiveSheetId, isOpen, loadVersion]);

  // Flatten formats to rule list with format reference
  const rulesWithFormats = useMemo((): RuleWithFormat[] => {
    const result: RuleWithFormat[] = [];
    for (const { format, sheetId } of sheetFormats) {
      for (const rule of format.rules) {
        result.push({ format, sheetId, rule });
      }
    }
    // Sort by priority
    result.sort((a, b) => a.rule.priority - b.rule.priority);
    return result;
  }, [sheetFormats]);

  // Format range for display
  const formatRange = useCallback((format: ConditionalFormat): string => {
    const ranges = format.ranges;
    if (!ranges || ranges.length === 0) return '';
    const range = ranges[0];
    const startCol = String.fromCharCode(65 + range.startCol);
    const endCol = String.fromCharCode(65 + range.endCol);
    return `${startCol}${range.startRow + 1}:${endCol}${range.endRow + 1}`;
  }, []);

  // Handle edit rule
  const handleEdit = useCallback(
    (format: ConditionalFormat, sheetId: SheetId) => {
      closeRulesManager();
      openCFDialog('edit', format, { sheetId, returnToRulesManager: true });
    },
    [closeRulesManager, openCFDialog],
  );

  // Handle delete rule
  const handleDelete = useCallback(
    async (formatId: string, ruleId: string, sheetId: SheetId) => {
      try {
        const result = await dispatch('DELETE_CF_RULE', actionDeps, { formatId, ruleId, sheetId });
        if (result.handled) {
          reload();
        } else {
          console.error('[CFRulesManager] deleteRule failed:', result.error ?? result.reason);
        }
      } catch (e) {
        console.error('[CFRulesManager] deleteRule failed:', e);
      }
    },
    [actionDeps, reload],
  );

  // Handle move up (decrease priority)
  const handleMoveUp = useCallback(
    async (format: ConditionalFormat, ruleId: string, sheetId: SheetId) => {
      const rule = format.rules.find((r) => r.id === ruleId);
      if (!rule || rule.priority <= 0) return;

      const updatedRules = format.rules.map((r) =>
        r.id === ruleId ? { ...r, priority: r.priority - 1 } : r,
      );
      try {
        const ws = wb.getSheetById(sheetId);
        await ws.conditionalFormats.update(format.id, { rules: updatedRules });
        reload();
      } catch (e) {
        console.error('[CFRulesManager] moveUp failed:', e);
      }
    },
    [wb, reload],
  );

  // Handle move down (increase priority)
  const handleMoveDown = useCallback(
    async (format: ConditionalFormat, ruleId: string, sheetId: SheetId) => {
      const rule = format.rules.find((r) => r.id === ruleId);
      if (!rule) return;

      const updatedRules = format.rules.map((r) =>
        r.id === ruleId ? { ...r, priority: r.priority + 1 } : r,
      );
      try {
        const ws = wb.getSheetById(sheetId);
        await ws.conditionalFormats.update(format.id, { rules: updatedRules });
        reload();
      } catch (e) {
        console.error('[CFRulesManager] moveDown failed:', e);
      }
    },
    [wb, reload],
  );

  // Handle toggle Stop If True (12.2: Stop If True UI in Rules Manager)
  const handleToggleStopIfTrue = useCallback(
    async (format: ConditionalFormat, ruleId: string, checked: boolean, sheetId: SheetId) => {
      const updatedRules = format.rules.map((r) =>
        r.id === ruleId ? { ...r, stopIfTrue: checked } : r,
      );
      try {
        const ws = wb.getSheetById(sheetId);
        await ws.conditionalFormats.update(format.id, { rules: updatedRules });
        reload();
      } catch (e) {
        console.error('[CFRulesManager] toggleStopIfTrue failed:', e);
      }
    },
    [wb, reload],
  );

  // Handle new rule
  const handleNewRule = useCallback(() => {
    closeRulesManager();
    openCFDialog('create');
  }, [closeRulesManager, openCFDialog]);

  // Handle clear all
  const handleClearAll = useCallback(async () => {
    if (
      !window.confirm(
        'Are you sure you want to clear all conditional formatting rules from this sheet?',
      )
    ) {
      return;
    }
    try {
      const ws = wb.getSheetById(activeSheetId);
      await ws.conditionalFormats.clear();
      reload();
    } catch (e) {
      console.error('[CFRulesManager] clearAll failed:', e);
    }
  }, [wb, activeSheetId, reload]);

  // Handle close
  const handleClose = useCallback(() => {
    closeRulesManager();
    setSelectedFormatId(null);
  }, [closeRulesManager]);

  if (!isOpen) {
    return null;
  }

  // Table configuration (12.2: Added Stop If True column)
  const tableColumns = ['Rule', 'Range', 'Stop', 'Actions'];
  const tableColumnWidths = '1fr 90px 80px 100px';

  return (
    <Dialog
      onEnterKeyDown={handleClose}
      open={isOpen}
      onClose={handleClose}
      dialogId="cf-rules-manager"
      width={600}
    >
      {/* Stable test-id marker for app-eval scenarios polling "is the manager mounted". */}
      <div data-testid="cf-rules-manager" hidden />
      <DialogHeader onClose={handleClose}>Conditional Formatting Rules Manager</DialogHeader>

      {/* Toolbar - Enhancement: Per-sheet dropdown lists each sheet individually */}
      <DialogToolbar>
        <div className="flex items-center gap-2">
          <span className="text-body-sm text-ss-text-secondary">Show rules for:</span>
          <Select
            options={sheetFilterOptions}
            value={sheetFilter}
            onChange={(value) => {
              // Ignore separator selection
              if (value !== '') {
                setSheetFilter(value);
              }
            }}
            className="min-w-[180px]"
          />
        </div>
        <span className="text-body-sm text-ss-text-secondary">
          {rulesWithFormats.length} rule{rulesWithFormats.length !== 1 ? 's' : ''}
        </span>
      </DialogToolbar>

      {/* Body - uses noPadding prop instead of !p-0 override */}
      <DialogBody noPadding>
        {rulesWithFormats.length === 0 ? (
          /* EmptyState - uses proper icon instead of emoji */
          <EmptyState
            icon="document-list"
            title="No conditional formatting rules"
            description='Click "New Rule" to create one'
          />
        ) : (
          /* DialogTable - uses text-caption for headers instead of text-hint */
          <DialogTable columns={tableColumns} columnWidths={tableColumnWidths}>
            {rulesWithFormats.map(({ format, sheetId, rule }, index) => (
              <CFRuleRow
                key={`${format.id}-${rule.id}`}
                format={format}
                rule={rule}
                index={index}
                rangeDisplay={formatRange(format)}
                sheetName={sheetFilter === FILTER_ALL_SHEETS ? getSheetName(sheetId) : undefined}
                isSelected={selectedFormatId === format.id}
                isFirst={index === 0}
                isLast={index === rulesWithFormats.length - 1}
                onSelect={() => setSelectedFormatId(format.id)}
                onEdit={() => handleEdit(format, sheetId)}
                onDelete={() => void handleDelete(format.id, rule.id, sheetId)}
                onMoveUp={() => void handleMoveUp(format, rule.id, sheetId)}
                onMoveDown={() => void handleMoveDown(format, rule.id, sheetId)}
                onToggleStopIfTrue={(checked) =>
                  void handleToggleStopIfTrue(format, rule.id, checked, sheetId)
                }
              />
            ))}
          </DialogTable>
        )}
      </DialogBody>

      {/* Footer - uses layout="between" prop instead of !justify-between override */}
      <DialogFooter layout="between">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleNewRule}>
            New Rule
          </Button>
          {rulesWithFormats.length > 0 && (
            <Button variant="danger" onClick={() => void handleClearAll()}>
              Clear All
            </Button>
          )}
        </div>
        <Button variant="primary" onClick={handleClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
