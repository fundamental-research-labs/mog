/**
 * OverlayLayer Component
 *
 * Renders all self-subscribing overlay components (context menus, popovers,
 * floating object editors). These overlays manage their own visibility state
 * and subscribe to relevant stores/contexts internally.
 *
 * This layer is rendered by SpreadsheetApp and provides a centralized location
 * for all floating UI elements that appear above the main spreadsheet content.
 */

// =============================================================================
// Paste Operation Dialogs
// =============================================================================
import {
  ConsolidateDialogContainerWrapper,
  FunctionArgumentsDialogContainer,
  InsertFunctionDialogContainer,
  PasteSpecialDialogContainerWrapper,
  RemoveDuplicatesDialogContainerWrapper,
  SubtotalDialogContainerWrapper,
  TextToColumnsDialogContainerWrapper,
} from '../../dialogs/coordinator-dialogs';
import { PasteOverwriteConfirmDialog } from '../../dialogs/paste/PasteOverwriteConfirmDialog';
import { PasteSizeMismatchDialog } from '../../dialogs/paste/PasteSizeMismatchDialog';
import { PasteValidationSummaryDialog } from '../../dialogs/paste/PasteValidationSummaryDialog';

// =============================================================================
// Table & Data Dialogs
// =============================================================================
import { InsertTableDialogWrapper } from '../../dialogs/insert/InsertTableDialog';
import { InsertSlicerDialog } from '../../dialogs/insert/InsertSlicerDialog';

// =============================================================================
// Sparkline Dialogs
// =============================================================================
import { EditSparklineDialog } from '../../dialogs/charts/EditSparklineDialog';
import { InsertSparklineDialogWrapper } from '../../dialogs/insert/InsertSparklineDialog';

// =============================================================================
// Picture & Object Dialogs
// =============================================================================
import { EditAltTextDialog } from '../../dialogs/charts/EditAltTextDialog';
import { FormatPictureDialog } from '../../dialogs/charts/FormatPictureDialog';
import { InsertPictureDialog } from '../../dialogs/insert/InsertPictureDialog';

// =============================================================================
// Shape & Object Menus
// =============================================================================
import { InsertShapeMenu } from '../toolbar/galleries/InsertShapeMenu';

// =============================================================================
// Store (for context menu instance keys)
// =============================================================================
import { useUIStore } from '../../infra/context';

// =============================================================================
// Floating Object Editors
// =============================================================================
import { TextBoxEditorOverlay } from '../../components/floating-objects';

// =============================================================================
// Fill Components
// =============================================================================
import {
  AutoFillOptionsButton,
  FillContextMenu,
  FlashFillSuggestionsPopup,
} from '../../components/fill';

// =============================================================================
// Comments
// =============================================================================
import { CommentPopover } from '../../components/comments';

// =============================================================================
// App-eval harness mirrors
// =============================================================================
import { HarnessOverlayMirrors } from '../../components/canvas-overlays/HarnessOverlayMirrors';
import { TotalRowDropdown } from '../../components/table/TotalRowDropdown';

// =============================================================================
// OverlayLayer Component
// =============================================================================

export function OverlayLayer() {
  const fillContextMenuInstanceId = useUIStore((s) => s.fillContextMenu.instanceId);

  return (
    <>
      {/* ================================================================== */}
      {/* Paste Operations */}
      {/* ================================================================== */}

      {/* Paste Special Dialog - inside provider for coordinator access */}
      <PasteSpecialDialogContainerWrapper />

      {/* Paste Size Mismatch Dialog - warns about paste size mismatch */}
      <PasteSizeMismatchDialog />

      {/* Paste Overwrite Confirm Dialog - cut-paste overwrite confirmation (Excel parity) */}
      <PasteOverwriteConfirmDialog />

      {/* Paste Validation Summary Dialog - shows validation violations after paste */}
      <PasteValidationSummaryDialog />

      {/* ================================================================== */}
      {/* Function Dialogs */}
      {/* ================================================================== */}

      {/* Insert Function Dialog - inside provider for editor state machine access */}
      <InsertFunctionDialogContainer />

      {/* Function Arguments Dialog - inside provider for editor state machine access */}
      <FunctionArgumentsDialogContainer />

      {/* ================================================================== */}
      {/* Data Operation Dialogs */}
      {/* ================================================================== */}

      {/* Remove Duplicates Dialog - inside provider for selection access */}
      <RemoveDuplicatesDialogContainerWrapper />

      {/* Text to Columns Dialog - inside provider for selection access */}
      <TextToColumnsDialogContainerWrapper />

      {/* Subtotals Dialog */}
      <SubtotalDialogContainerWrapper />

      {/* Consolidate Dialog */}
      <ConsolidateDialogContainerWrapper />

      {/* ================================================================== */}
      {/* Table & Sparkline Dialogs */}
      {/* ================================================================== */}

      {/* Insert Table Dialog */}
      <InsertTableDialogWrapper />

      {/* Insert Slicer Dialog */}
      <InsertSlicerDialog />

      {/* Insert Sparkline Dialog */}
      <InsertSparklineDialogWrapper />

      {/* Edit Sparkline Dialog */}
      <EditSparklineDialog />

      {/* ================================================================== */}
      {/* Picture & Object Dialogs */}
      {/* ================================================================== */}

      {/* Insert Picture Dialog */}
      <InsertPictureDialog />

      {/* Format Picture Dialog */}
      <FormatPictureDialog />

      {/* Edit Alt Text Dialog */}
      <EditAltTextDialog />

      {/* ================================================================== */}
      {/* Context Menus */}
      {/* ================================================================== */}

      {/* Cell Context Menu — now rendered by SpreadsheetGrid via Radix ContextMenu */}

      {/* Insert Shape Menu */}
      <InsertShapeMenu />

      {/* Table total row function dropdown */}
      <TotalRowDropdown />

      {/* Object Context Menu — now rendered by SpreadsheetGrid via Radix ContextMenu */}

      {/* ================================================================== */}
      {/* Floating Object Editors */}
      {/* ================================================================== */}

      {/* Text Box Editor Overlay - inline editing for text boxes */}
      <TextBoxEditorOverlay />

      {/* ================================================================== */}
      {/* Fill Components */}
      {/* ================================================================== */}

      {/* AutoFill Options Button */}
      <AutoFillOptionsButton />

      {/* Fill Context Menu - Right-Click Drag Fill */}
      <FillContextMenu key={fillContextMenuInstanceId} />

      {/* Flash Fill Suggestions Popup */}
      <FlashFillSuggestionsPopup />

      {/* ================================================================== */}
      {/* Comments */}
      {/* ================================================================== */}

      {/* Comment Popover */}
      <CommentPopover />

      {/* ================================================================== */}
      {/* App-eval harness DOM mirrors */}
      {/* ================================================================== */}

      {/* Invisible DOM shadows of canvas-only overlay state (validation circles,
 flash-fill preview) so harness observers can read rendered overlay
 positions via the DOM. */}
      <HarnessOverlayMirrors />
    </>
  );
}
