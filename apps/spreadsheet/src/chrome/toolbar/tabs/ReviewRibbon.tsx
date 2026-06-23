/**
 * ReviewRibbon
 *
 * Review tab content matching Excel 365 group order:
 * 1. Proofing - Spelling, Thesaurus, Workbook Statistics
 * 2. Accessibility - Check Accessibility
 * 3. Comments - New Comment, Delete, Previous, Next, Show/Hide Comment, Show All Comments
 * 4. Protect - Protect Sheet, Protect Workbook, Always Open Read-Only
 *
 * Note: We use Comments only (no separate Notes). Excel 365 separates Notes from Comments,
 *
 * Status: Protection dialogs implemented. Comments group wired to action handlers.
 * Other features are stubs - placeholders for future implementation.
 */

import { useCallback, useEffect } from 'react';
import { History as VersionHistoryIcon } from 'lucide-react';
import { dispatch, useFeatureGate, useUIStore } from '../../../internal-api';

import {
  ACCESSIBILITY_COLLAPSE_CONFIG,
  COMMENTS_COLLAPSE_CONFIG,
  DEFAULT_COLLAPSE_CONFIG,
  PROOFING_COLLAPSE_CONFIG,
  PROTECT_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import { useComments } from '../../../hooks/comments/use-comments';
import { useSheetProtection } from '../../../hooks/structure/use-sheet-protection';
import { useWorkbookStructureProtection } from '../../../hooks/structure/use-workbook-protection';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  CommentIcon,
  ProtectSheetIcon,
  ProtectWorkbookIcon,
  SpellCheckIcon,
} from '../primitives/ToolbarIcons';
// =============================================================================
// Inline Icons for Review Tab (stubs - not yet in ToolbarIcons.tsx)
// =============================================================================

/** Delete comment/note icon */
function DeleteCommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Previous comment/note icon */
function PreviousCommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 12L6 8l4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Next comment/note icon */
function NextCommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6 12l4-4-4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Thesaurus icon (book with magnifying glass) */
function ThesaurusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H2V2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 2v12" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 12l1.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Workbook Statistics icon (chart/stats) */
function WorkbookStatisticsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 10V7M8 10V5M11 10V8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Accessibility check icon */
function AccessibilityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 5v3M8 8l-2.5 4M8 8l2.5 4M4 6.5h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Show/Hide Comment icon (comment with eye) */
function ShowHideCommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 3h10a1 1 0 011 1v5a1 1 0 01-1 1H5l-3 2V3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="11" cy="12" rx="3" ry="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/** Show All Comments icon (multiple comments) */
function ShowAllCommentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 2h8a1 1 0 011 1v4a1 1 0 01-1 1H4l-2 2V2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 9h7a1 1 0 011 1v4l-2-2H5a1 1 0 01-1-1v-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Always Open Read-Only icon (lock with document) */
function ReadOnlyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="7" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6 7V5a2 2 0 114 0v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

// =============================================================================
// Component
// =============================================================================

export function ReviewRibbon() {
  const deps = useActionDependencies();
  const { hasComments } = useComments();
  const versionControlEnabled = useFeatureGate('capabilities', 'versionControl');

  // UI store state for "Show All Comments" toggle (read only - writes via dispatch)
  const showAllComments = useUIStore((s) => s.showAllComments);
  const setSidePanelVisible = useUIStore((s) => s.setSidePanelVisible);
  const setSidePanelContent = useUIStore((s) => s.setSidePanelContent);

  // Get active sheet ID and protection state via reactive hook
  const activeSheetId = useUIStore((s) => s.activeSheetId);
  const { protection } = useSheetProtection(activeSheetId);
  const isProtected = protection.isProtected;
  const isWorkbookStructureProtected = useWorkbookStructureProtection();

  // Protection button handlers
  const handleProtectSheet = useCallback(() => {
    if (isProtected) {
      dispatch('OPEN_UNPROTECT_SHEET_DIALOG', deps);
    } else {
      dispatch('OPEN_PROTECT_SHEET_DIALOG', deps);
    }
  }, [deps, isProtected]);

  const handleProtectWorkbook = useCallback(() => {
    dispatch('OPEN_PROTECT_WORKBOOK_DIALOG', deps);
  }, [deps]);

  // ==========================================================================
  // Comment action handlers
  // ==========================================================================

  /** Insert a new comment on the active cell */
  const handleNewComment = useCallback(() => {
    dispatch('INSERT_COMMENT', deps);
  }, [deps]);

  /** Delete comment(s) on the active cell */
  const handleDeleteComment = useCallback(() => {
    dispatch('DELETE_COMMENT', deps);
  }, [deps]);

  /** Navigate to previous cell with a comment */
  const handlePreviousComment = useCallback(() => {
    dispatch('PREVIOUS_COMMENT', deps);
  }, [deps]);

  /** Navigate to next cell with a comment */
  const handleNextComment = useCallback(() => {
    dispatch('NEXT_COMMENT', deps);
  }, [deps]);

  /** Toggle visibility of comment on current cell */
  const handleShowHideComment = useCallback(() => {
    dispatch('SHOW_HIDE_COMMENTS', deps);
  }, [deps]);

  /** Toggle visibility of all comments in the sheet - uses dispatch per architecture */
  const handleToggleShowAllComments = useCallback(() => {
    dispatch('TOGGLE_SHOW_ALL_COMMENTS', deps);
  }, [deps]);

  // ==========================================================================
  // Proofing action handlers
  // ==========================================================================

  /** Open Spelling dialog (uses existing DataAnalysisDialogActionType) */
  const handleSpelling = useCallback(() => {
    dispatch('OPEN_SPELLING_DIALOG', deps);
  }, [deps]);

  /** Open Thesaurus dialog */
  const handleThesaurus = useCallback(() => {
    dispatch('OPEN_THESAURUS_DIALOG', deps);
  }, [deps]);

  /** Show Workbook Statistics */
  const handleWorkbookStatistics = useCallback(() => {
    dispatch('SHOW_WORKBOOK_STATISTICS', deps);
  }, [deps]);

  /** Check Accessibility */
  const handleCheckAccessibility = useCallback(() => {
    dispatch('CHECK_ACCESSIBILITY', deps);
  }, [deps]);

  const handleOpenVersionHistory = useCallback(() => {
    if (!versionControlEnabled) return;
    setSidePanelContent('version-history');
    setSidePanelVisible(true);
  }, [setSidePanelContent, setSidePanelVisible, versionControlEnabled]);

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-review.ts`.)
  // ===========================================================================

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    keyTipRegistry.register({ key: 'C', tabId: 'review', elementId: 'review-new-comment' });
    cleanups.push(() => keyTipRegistry.unregister('C', 'review'));

    keyTipRegistry.register({ key: 'D', tabId: 'review', elementId: 'review-delete-comment' });
    cleanups.push(() => keyTipRegistry.unregister('D', 'review'));

    keyTipRegistry.register({ key: 'P', tabId: 'review', elementId: 'review-previous-comment' });
    cleanups.push(() => keyTipRegistry.unregister('P', 'review'));

    keyTipRegistry.register({ key: 'N', tabId: 'review', elementId: 'review-next-comment' });
    cleanups.push(() => keyTipRegistry.unregister('N', 'review'));

    keyTipRegistry.register({ key: 'A', tabId: 'review', elementId: 'review-show-all-comments' });
    cleanups.push(() => keyTipRegistry.unregister('A', 'review'));

    keyTipRegistry.register({ key: 'S', tabId: 'review', elementId: 'review-protect-sheet' });
    cleanups.push(() => keyTipRegistry.unregister('S', 'review'));

    keyTipRegistry.register({ key: 'W', tabId: 'review', elementId: 'review-protect-workbook' });
    cleanups.push(() => keyTipRegistry.unregister('W', 'review'));

    if (versionControlEnabled) {
      keyTipRegistry.register({ key: 'V', tabId: 'review', elementId: 'review-version-history' });
      cleanups.push(() => keyTipRegistry.unregister('V', 'review'));
    }

    return () => cleanups.forEach((c) => c());
  }, [versionControlEnabled]);

  return (
    <>
      {/* 1. Proofing Group */}
      <ToolbarGroup
        label="Proofing"
        collapseConfig={PROOFING_COLLAPSE_CONFIG}
        dropdownIcon={<SpellCheckIcon />}
      >
        <div className="flex items-center gap-0.5">
          <RibbonButton
            id="review-spelling"
            layout="vertical"
            height="full"
            icon={<SpellCheckIcon />}
            label="Spelling"
            onClick={handleSpelling}
            title="Spelling (F7)"
            aria-label="Spelling"
          />
          <RibbonButton
            id="review-thesaurus"
            layout="vertical"
            height="full"
            icon={<ThesaurusIcon />}
            label="Thesaurus"
            onClick={handleThesaurus}
            title="Thesaurus (Shift+F7)"
            aria-label="Thesaurus"
          />
          <RibbonButton
            id="review-workbook-stats"
            layout="vertical"
            height="full"
            icon={<WorkbookStatisticsIcon />}
            label={'Workbook\nStatistics'}
            onClick={handleWorkbookStatistics}
            title="Workbook Statistics"
            aria-label="Workbook Statistics"
          />
        </div>
      </ToolbarGroup>

      {/* 2. Accessibility Group */}
      <ToolbarGroup
        label="Accessibility"
        collapseConfig={ACCESSIBILITY_COLLAPSE_CONFIG}
        dropdownIcon={<AccessibilityIcon />}
      >
        <RibbonButton
          id="review-check-accessibility"
          layout="vertical"
          height="full"
          icon={<AccessibilityIcon />}
          label={'Check\nAccessibility'}
          onClick={handleCheckAccessibility}
          title="Check Accessibility"
          aria-label="Check Accessibility"
        />
      </ToolbarGroup>

      {/* 3. Comments Group - R2: Expanded with navigation buttons */}
      <ToolbarGroup
        label="Comments"
        collapseConfig={COMMENTS_COLLAPSE_CONFIG}
        dropdownIcon={<CommentIcon />}
      >
        <div className="flex items-center gap-0.5">
          <RibbonButton
            id="review-new-comment"
            layout="vertical"
            height="full"
            icon={<CommentIcon />}
            label={'New\nComment'}
            onClick={handleNewComment}
            title="New Comment (Shift+F2)"
            aria-label="New Comment"
          />
          <RibbonButton
            id="review-delete-comment"
            layout="vertical"
            height="full"
            icon={<DeleteCommentIcon />}
            label="Delete"
            onClick={handleDeleteComment}
            disabled={!hasComments}
            title="Delete Comment"
            aria-label="Delete Comment"
          />
          <RibbonButton
            id="review-previous-comment"
            layout="vertical"
            height="full"
            icon={<PreviousCommentIcon />}
            label="Previous"
            onClick={handlePreviousComment}
            title="Previous Comment"
            aria-label="Previous Comment"
          />
          <RibbonButton
            id="review-next-comment"
            layout="vertical"
            height="full"
            icon={<NextCommentIcon />}
            label="Next"
            onClick={handleNextComment}
            title="Next Comment"
            aria-label="Next Comment"
          />
          <div className="flex flex-col gap-0.5">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<ShowHideCommentIcon />}
              label="Show/Hide Comment"
              onClick={handleShowHideComment}
              disabled={!hasComments}
              title="Show/Hide Comment"
              aria-label="Show/Hide Comment"
              visibilityKey="showHideComment"
            />
            <RibbonButton
              id="review-show-all-comments"
              layout="horizontal"
              height="half"
              icon={<ShowAllCommentsIcon />}
              label="Show All Comments"
              onClick={handleToggleShowAllComments}
              isOpen={showAllComments}
              title={showAllComments ? 'Hide All Comments' : 'Show All Comments'}
              aria-label="Show All Comments"
              aria-pressed={showAllComments}
              visibilityKey="showComments"
            />
          </div>
        </div>
      </ToolbarGroup>

      {versionControlEnabled ? (
        <ToolbarGroup
          label="Version"
          collapseConfig={DEFAULT_COLLAPSE_CONFIG}
          dropdownIcon={<VersionHistoryIcon size={16} strokeWidth={1.75} />}
        >
          <RibbonButton
            id="review-version-history"
            layout="vertical"
            height="full"
            icon={<VersionHistoryIcon size={16} strokeWidth={1.75} />}
            label={'Version\nHistory'}
            onClick={handleOpenVersionHistory}
            data-testid="review-version-history"
            data-action="open-version-history"
            title="Version History"
            aria-label="Version History"
          />
        </ToolbarGroup>
      ) : null}

      {/* 5. Protect Group - R1: Renamed from "Changes" to "Protect" (Excel terminology) */}
      {/* Excel shows Protect Sheet and Protect Workbook as large buttons side by side */}
      <ToolbarGroup
        label="Protect"
        isLast
        collapseConfig={PROTECT_COLLAPSE_CONFIG}
        dropdownIcon={<ProtectSheetIcon />}
      >
        <div className="flex items-center gap-0.5">
          <RibbonButton
            id="review-protect-sheet"
            layout="vertical"
            height="full"
            icon={<ProtectSheetIcon />}
            label={isProtected ? 'Unprotect\nSheet' : 'Protect\nSheet'}
            onClick={handleProtectSheet}
            title={isProtected ? 'Unprotect Sheet' : 'Protect Sheet'}
            aria-label={isProtected ? 'Unprotect Sheet' : 'Protect Sheet'}
            visibilityKey="protectSheet"
          />
          <RibbonButton
            id="review-protect-workbook"
            layout="vertical"
            height="full"
            icon={<ProtectWorkbookIcon />}
            label={isWorkbookStructureProtected ? 'Unprotect\nWorkbook' : 'Protect\nWorkbook'}
            onClick={handleProtectWorkbook}
            title={
              isWorkbookStructureProtected
                ? 'Unprotect Workbook'
                : 'Protect Workbook (structure protection)'
            }
            aria-label={isWorkbookStructureProtected ? 'Unprotect Workbook' : 'Protect Workbook'}
          />
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<ReadOnlyIcon />}
            label={'Always Open\nRead-Only'}
            disabled
            title="Always Open Read-Only (coming soon)"
            aria-label="Always Open Read-Only"
            visibilityKey="alwaysOpenReadOnly"
          />
        </div>
      </ToolbarGroup>
    </>
  );
}
