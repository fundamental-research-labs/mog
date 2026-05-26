/**
 * File menu view component
 *
 * Full-screen overlay for the File menu.
 * Displays file operations, document info, and application settings.
 *
 * Architecture:
 * - Uses Unified Action System via dispatch() for all user interactions
 * - State managed by the UIStore file-menu slice
 * - Pushes a `dialog` focus layer while open so the
 * focus machine and any keyboard consumer see the file menu as a dialog.
 * Escape closes via a capture-phase document listener so it wins over
 * the grid's bubble-phase React onKeyDown (which would otherwise fire
 * CLEAR_CLIPBOARD and stop propagation before the file menu handler runs).
 */

import { useCallback, useEffect } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../../internal-api';
import { useFocus } from '../../../hooks/navigation/use-focus';
import { useCoordinator } from '../../../hooks/shared/use-coordinator';
import { BackstageNav } from './BackstageNav';
import { BrowseFilesPanel } from './BrowseFilesPanel';
import { ExportPanel } from './ExportPanel';
import { InfoPanel } from './InfoPanel';
import { NewPanel } from './NewPanel';
import { OpenPanel } from './OpenPanel';
import { PrintPanel } from './PrintPanel';
import { RecentsPanel } from './RecentsPanel';
import { SaveAsPanel } from './SaveAsPanel';
import { SavePanel } from './SavePanel';
import { SharePanel } from './SharePanel';

const BACKSTAGE_FOCUS_LAYER_ID = 'backstage';

export function BackstageView() {
  const deps = useActionDependencies();
  const backstage = useUIStore((s) => s.backstage);
  const focus = useFocus();
  const coordinator = useCoordinator();

  const handleClose = useCallback(() => {
    dispatch('CLOSE_BACKSTAGE', deps);
  }, [deps]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dispatch('CLOSE_BACKSTAGE', deps);
      }
    },
    [deps],
  );

  //: register the file menu as a `dialog` focus layer so
  // every focus consumer (keyboard coordinator, alt-mode hint suppression,
  // command palette gating, etc.) sees it uniformly as a dialog
  // without growing FocusLayerType. The pushLayer/popLayer is only mounted
  // while the panel is visible; React unmount runs the cleanup.
  //
  // On close, drive DOM focus back to the grid container. Default focus
  // restoration would return to the trigger element that opened the
  // File menu, but the chrome-symmetry harness expects dismissing File to
  // return the user to
  // the editing surface so the next keystroke types into a cell.
  useEffect(() => {
    if (!backstage.isOpen) return;
    focus.pushLayer('dialog', BACKSTAGE_FOCUS_LAYER_ID);
    return () => {
      focus.popLayer();
      coordinator.input.focusGrid();
    };
  }, [backstage.isOpen, focus, coordinator]);

  // Document-level Escape listener. We use capture phase so Escape is
  // intercepted before React's bubble-phase delegation (which would fire
  // the grid's onKeyDown and dispatch CLEAR_CLIPBOARD, stopping
  // propagation before our bubble handler could run).
  useEffect(() => {
    if (!backstage.isOpen) return;
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [backstage.isOpen, handleKeyDown]);

  if (!backstage.isOpen) {
    return null;
  }

  // Render the active panel
  const renderPanel = () => {
    switch (backstage.activePanel) {
      case 'info':
        return <InfoPanel />;
      case 'new':
        return <NewPanel />;
      case 'open':
        return <OpenPanel />;
      case 'browse-files':
        return <BrowseFilesPanel />;
      case 'recents':
        return <RecentsPanel />;
      case 'save':
        return <SavePanel />;
      case 'save-as':
        return <SaveAsPanel />;
      case 'print':
        return <PrintPanel />;
      case 'share':
        return <SharePanel />;
      case 'export':
        return <ExportPanel />;
      default:
        return <InfoPanel />;
    }
  };

  return (
    <div
      data-testid="file-menu"
      role="dialog"
      aria-modal="true"
      aria-label="File menu"
      className="fixed inset-0 z-ss-modal bg-ss-surface flex"
    >
      {/* Left navigation */}
      <BackstageNav activePanel={backstage.activePanel} onClose={handleClose} />

      {/* Right content area */}
      {renderPanel()}
    </div>
  );
}
