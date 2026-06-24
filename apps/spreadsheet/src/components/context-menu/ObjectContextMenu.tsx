/**
 * Object Context Menu
 *
 * Right-click context menu for floating objects (pictures, shapes, text boxes).
 * Provides quick access to common operations like cut/copy/paste, z-order, and delete.
 *
 * Architecture notes:
 * - Menu UI state is in UIStore (ephemeral, not collaborative)
 * - Actions route through dispatch() for Unified Action System compliance
 * - Object selection state is in object-interaction-machine
 * - Uses Radix ContextMenu (wraps grid trigger area, positioned from native event)
 *
 * @see docs/renderer/README.md - Architecture principles
 * @see docs/ARCHITECTURE-CHECKLIST.md - Unified Action System pattern
 */

import React, { useCallback, useMemo } from 'react';

import {
  BringForwardLayerSvg,
  BringToFrontLayerSvg,
  CopySvg,
  CutSvg,
  DeleteSvg,
  DownloadSvg,
  DuplicateSvg,
  EditSvg,
  ImageSvg,
  LinkSvg,
  SendBackwardLayerSvg,
  SendToBackLayerSvg,
  SettingsSvg,
  wrapIcon,
} from '@mog/icons';

import { useUIStore } from '../../internal-api';
import { dispatch } from '../../actions';
import { useFloatingObject } from '../../hooks/objects/use-floating-object';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import {
  ContextMenuContent,
  ContextMenuItem as ContextMenuItemComponent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@mog/shell/components/ui';

// =============================================================================
// Icon Components (wrapped from @mog/icons)
// =============================================================================

const CutIcon = wrapIcon(CutSvg, 'toolbar');
const CopyIcon = wrapIcon(CopySvg, 'toolbar');
const DuplicateIcon = wrapIcon(DuplicateSvg, 'toolbar');
const DeleteIcon = wrapIcon(DeleteSvg, 'toolbar');
const BringToFrontIcon = wrapIcon(BringToFrontLayerSvg, 'toolbar');
const SendToBackIcon = wrapIcon(SendToBackLayerSvg, 'toolbar');
const BringForwardIcon = wrapIcon(BringForwardLayerSvg, 'toolbar');
const SendBackwardIcon = wrapIcon(SendBackwardLayerSvg, 'toolbar');
const ImageIcon = wrapIcon(ImageSvg, 'toolbar');
const SettingsIcon = wrapIcon(SettingsSvg, 'toolbar');
const EditIcon = wrapIcon(EditSvg, 'toolbar');
const DownloadIcon = wrapIcon(DownloadSvg, 'toolbar');
const LinkIcon = wrapIcon(LinkSvg, 'toolbar');

// =============================================================================
// Types
// =============================================================================

interface MenuItemData {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  dividerAfter?: boolean;
  children?: MenuItemData[];
}

// =============================================================================
// Helper to render menu items recursively
// =============================================================================

interface MenuItemRendererProps {
  items: MenuItemData[];
  onClose: () => void;
}

function MenuItemRenderer({ items, onClose }: MenuItemRendererProps) {
  return (
    <>
      {items.map((item, index) => (
        <React.Fragment key={item.id}>
          {item.children && item.children.length > 0 ? (
            // Render as submenu
            <ContextMenuSub>
              <ContextMenuSubTrigger icon={item.icon} disabled={item.disabled}>
                {item.label}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <MenuItemRenderer items={item.children} onClose={onClose} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : (
            // Render as regular item
            <ContextMenuItemComponent
              icon={item.icon}
              shortcut={item.shortcut}
              disabled={item.disabled}
              destructive={item.destructive}
              onSelect={() => {
                item.onClick();
                onClose();
              }}
            >
              {item.label}
            </ContextMenuItemComponent>
          )}
          {item.dividerAfter && index < items.length - 1 && <ContextMenuSeparator />}
        </React.Fragment>
      ))}
    </>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ObjectContextMenu() {
  const objectContextMenu = useUIStore((s) => s.objectContextMenu);
  const closeMenu = useUIStore((s) => s.closeObjectContextMenu);
  // SAVE_PICTURE_AS_FILE / CHANGE_PICTURE now route
  // through `deps.platform.dialogs.*` (see actions/handlers/object.ts), so the
  // local `onUIAction` mock that used to live here is dead code. The canonical
  // deps source provides `platform` and everything else SAVE/CHANGE need.
  const deps = useActionDependencies();

  const { isOpen, targetObjectId } = objectContextMenu;

  // Read from the Zustand store (sync, populated by event-driven re-fetching)
  const targetObject = useFloatingObject(targetObjectId ?? '');
  const isSelectedChart =
    targetObjectId !== null && deps.accessors.chart.getSelectedChartIds().has(targetObjectId);
  const isChart = targetObject?.type === 'chart' || isSelectedChart;
  const isPicture = targetObject?.type === 'picture';
  const isEquation = targetObject?.type === 'equation';

  // Action handlers
  // Wire floating object clipboard operations

  /**
   * Copy object to clipboard.
   * For pictures, copies the image to clipboard (if supported).
   * For all objects, stores JSON representation for internal paste.
   */
  const handleCopy = useCallback(async () => {
    if (!targetObjectId || !targetObject) return;

    try {
      // Create clipboard data with object info
      const clipboardData = {
        type: 'shortcut-floating-object',
        object: targetObject,
        timestamp: Date.now(),
      };

      // For pictures, try to copy image to clipboard
      if (targetObject.type === 'picture') {
        const src = (targetObject as { src: string }).src;
        if (src && typeof navigator.clipboard?.write === 'function') {
          try {
            // Fetch the image and convert to blob
            const response = await fetch(src);
            const blob = await response.blob();

            // Write both image and text to clipboard
            await navigator.clipboard.write([
              new ClipboardItem({
                [blob.type]: blob,
                'text/plain': new Blob([JSON.stringify(clipboardData)], { type: 'text/plain' }),
              }),
            ]);
            return;
          } catch {
            // Fall through to text-only copy
          }
        }
      }

      // Fallback: copy JSON representation to clipboard
      await navigator.clipboard.writeText(JSON.stringify(clipboardData));
    } catch (error) {
      console.error('[ObjectContextMenu] Failed to copy to clipboard:', error);
    }
  }, [targetObjectId, targetObject]);

  /**
   * Cut object: copy to clipboard then delete.
   */
  const handleCut = useCallback(async () => {
    if (!targetObjectId) return;

    // Copy first
    await handleCopy();

    if (isChart) {
      dispatch('DELETE_CHART', deps, { chartId: targetObjectId });
      return;
    }

    dispatch('DELETE_OBJECT', deps);
  }, [targetObjectId, handleCopy, isChart, deps]);

  const handleDuplicate = useCallback(() => {
    if (!targetObjectId) return;
    if (isChart) {
      dispatch('DUPLICATE_CHART', deps, { chartId: targetObjectId });
      return;
    }
    dispatch('DUPLICATE_OBJECT', deps);
  }, [targetObjectId, isChart, deps]);

  const handleDelete = useCallback(() => {
    if (!targetObjectId) return;
    if (isChart) {
      dispatch('DELETE_CHART', deps, { chartId: targetObjectId });
      return;
    }
    dispatch('DELETE_OBJECT', deps);
  }, [targetObjectId, isChart, deps]);

  const handleBringToFront = useCallback(() => {
    if (!targetObjectId) return;
    if (isChart) {
      dispatch('BRING_CHART_TO_FRONT', deps, { chartId: targetObjectId });
      return;
    }
    dispatch('BRING_OBJECT_TO_FRONT', deps, { objectId: targetObjectId });
  }, [targetObjectId, isChart, deps]);

  const handleSendToBack = useCallback(() => {
    if (!targetObjectId) return;
    if (isChart) {
      dispatch('SEND_CHART_TO_BACK', deps, { chartId: targetObjectId });
      return;
    }
    dispatch('SEND_OBJECT_TO_BACK', deps, { objectId: targetObjectId });
  }, [targetObjectId, isChart, deps]);

  const handleBringForward = useCallback(() => {
    if (!targetObjectId) return;
    if (isChart) {
      dispatch('BRING_CHART_FORWARD', deps, { chartId: targetObjectId });
      return;
    }
    dispatch('BRING_OBJECT_FORWARD', deps, { objectId: targetObjectId });
  }, [targetObjectId, isChart, deps]);

  const handleSendBackward = useCallback(() => {
    if (!targetObjectId) return;
    if (isChart) {
      dispatch('SEND_CHART_BACKWARD', deps, { chartId: targetObjectId });
      return;
    }
    dispatch('SEND_OBJECT_BACKWARD', deps, { objectId: targetObjectId });
  }, [targetObjectId, isChart, deps]);

  // Picture-specific handlers using dispatch()
  const handleFormatPicture = useCallback(() => {
    if (!targetObjectId) return;
    dispatch('OPEN_FORMAT_PICTURE_DIALOG', deps, { objectId: targetObjectId });
  }, [targetObjectId, deps]);

  const handleEditAltText = useCallback(() => {
    if (!targetObjectId) return;
    dispatch('OPEN_EDIT_ALT_TEXT_DIALOG', deps, { objectId: targetObjectId });
  }, [targetObjectId, deps]);

  const handleSaveAsPicture = useCallback(() => {
    if (!targetObjectId) return;
    dispatch('SAVE_PICTURE_AS_FILE', deps, { objectId: targetObjectId });
  }, [targetObjectId, deps]);

  const handleAssignHyperlink = useCallback(() => {
    // TODO: Implement hyperlink assignment for pictures
    console.log('Assign hyperlink to object:', targetObjectId);
  }, [targetObjectId]);

  // Change Picture - opens file picker to replace image
  const handleChangePicture = useCallback(() => {
    if (!targetObjectId) return;
    dispatch('CHANGE_PICTURE', deps, { objectId: targetObjectId });
  }, [targetObjectId, deps]);

  // Reset Picture - restores original size and cropping
  const handleResetPicture = useCallback(() => {
    if (!targetObjectId) return;
    dispatch('RESET_PICTURE', deps, { objectId: targetObjectId });
  }, [targetObjectId, deps]);

  const handleFormatChartArea = useCallback(() => {
    if (!targetObjectId) return;
    dispatch('OPEN_FORMAT_CHART_AREA', deps, { chartId: targetObjectId });
  }, [targetObjectId, deps]);

  // Equation-specific handler
  const handleEditEquation = useCallback(() => {
    if (!targetObjectId) return;
    dispatch('EDIT_EQUATION', deps, { equationId: targetObjectId });
  }, [targetObjectId, deps]);

  // Build menu items
  const menuItems = useMemo((): MenuItemData[] => {
    const items: MenuItemData[] = [];

    // Clipboard Section
    items.push({
      id: 'cut',
      label: 'Cut',
      icon: <CutIcon />,
      shortcut: 'Ctrl+X',
      onClick: handleCut,
    });

    items.push({
      id: 'copy',
      label: 'Copy',
      icon: <CopyIcon />,
      shortcut: 'Ctrl+C',
      onClick: handleCopy,
    });

    items.push({
      id: 'duplicate',
      label: 'Duplicate',
      icon: <DuplicateIcon />,
      shortcut: 'Ctrl+D',
      dividerAfter: true,
      onClick: handleDuplicate,
    });

    // Picture-specific: Size and Properties (before Z-order)
    if (isPicture) {
      items.push({
        id: 'sizeProperties',
        label: 'Size and Properties...',
        icon: <SettingsIcon />,
        onClick: handleFormatPicture,
      });
    } else if (isChart) {
      items.push({
        id: 'formatChartArea',
        label: 'Format Chart Area...',
        icon: <SettingsIcon />,
        onClick: handleFormatChartArea,
      });
    }

    // Z-Order Section
    items.push({
      id: 'order',
      label: 'Order',
      icon: <BringToFrontIcon />,
      onClick: () => {},
      children: [
        {
          id: 'bringToFront',
          label: 'Bring to Front',
          icon: <BringToFrontIcon />,
          onClick: handleBringToFront,
        },
        {
          id: 'sendToBack',
          label: 'Send to Back',
          icon: <SendToBackIcon />,
          onClick: handleSendToBack,
        },
        {
          id: 'bringForward',
          label: 'Bring Forward',
          icon: <BringForwardIcon />,
          onClick: handleBringForward,
        },
        {
          id: 'sendBackward',
          label: 'Send Backward',
          icon: <SendBackwardIcon />,
          onClick: handleSendBackward,
        },
      ],
      dividerAfter: isPicture || isEquation, // Add divider after Z-order if picture or equation
    });

    // Equation-specific items (after Z-order)
    if (isEquation) {
      items.push({
        id: 'editEquation',
        label: 'Edit Equation...',
        icon: <EditIcon />,
        onClick: handleEditEquation,
        dividerAfter: true, // Add divider before delete
      });
    }

    // Picture-specific items (after Z-order)
    if (isPicture) {
      items.push({
        id: 'formatPicture',
        label: 'Format Picture...',
        icon: <ImageIcon />,
        onClick: handleFormatPicture,
      });

      // Change Picture option
      items.push({
        id: 'changePicture',
        label: 'Change Picture...',
        icon: <ImageIcon />,
        onClick: handleChangePicture,
      });

      // Reset Picture option
      items.push({
        id: 'resetPicture',
        label: 'Reset Picture',
        onClick: handleResetPicture,
      });

      items.push({
        id: 'editAltText',
        label: 'Edit Alt Text...',
        icon: <EditIcon />,
        onClick: handleEditAltText,
      });

      items.push({
        id: 'saveAsPicture',
        label: 'Save as Picture...',
        icon: <DownloadIcon />,
        onClick: handleSaveAsPicture,
      });

      items.push({
        id: 'assignHyperlink',
        label: 'Assign Hyperlink...',
        icon: <LinkIcon />,
        onClick: handleAssignHyperlink,
        dividerAfter: true, // Add divider before delete
      });
    } else if (!isEquation) {
      // Add divider before delete for non-picture, non-equation objects
      items[items.length - 1].dividerAfter = true;
    }

    // Delete Section
    items.push({
      id: 'delete',
      label: 'Delete',
      icon: <DeleteIcon />,
      shortcut: 'Del',
      destructive: true,
      onClick: handleDelete,
    });

    return items;
  }, [
    isPicture,
    isChart,
    isEquation,
    handleCut,
    handleCopy,
    handleDuplicate,
    handleFormatPicture,
    handleChangePicture,
    handleResetPicture,
    handleFormatChartArea,
    handleBringToFront,
    handleSendToBack,
    handleBringForward,
    handleSendBackward,
    handleEditAltText,
    handleSaveAsPicture,
    handleAssignHyperlink,
    handleEditEquation,
    handleDelete,
  ]);

  if (!isOpen) return null;

  return (
    <ContextMenuContent
      className="py-1 min-w-[200px]"
      data-testid="context-menu"
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <MenuItemRenderer items={menuItems} onClose={closeMenu} />
    </ContextMenuContent>
  );
}
