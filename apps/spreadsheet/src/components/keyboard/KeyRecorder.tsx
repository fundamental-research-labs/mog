/**
 * KeyRecorder Component
 *
 * Captures keyboard input and converts it to a PhysicalKeyBinding.
 * Used in the keyboard shortcuts customization dialog.
 *
 * Features:
 * - Displays current key combination as user presses keys
 * - Shows modifiers being held
 * - Calls onCapture when a complete binding is detected
 * - Supports Escape to cancel
 *
 * @example
 * ```tsx
 * <KeyRecorder
 * onCapture={(binding) => setNewBinding(binding)}
 * onCancel={ => setRecording(false)}
 * currentBinding={{ code: 'KeyC', modifiers: ['ctrl'] }}
 * />
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ModifierKey, PhysicalKeyBinding, Platform } from '@mog-sdk/contracts/keyboard';
import { usePlatformInfo } from '@mog/shell';
import { toDisplayString } from '../../keyboard';
// =============================================================================
// Types
// =============================================================================

export interface KeyRecorderProps {
  /** Called when a valid key combination is captured */
  onCapture: (binding: PhysicalKeyBinding) => void;
  /** Called when user cancels (Escape) */
  onCancel: () => void;
  /** Current binding to show as placeholder */
  currentBinding?: PhysicalKeyBinding;
  /** Platform for display formatting */
  platform?: Platform;
}

interface RecordingState {
  /** Currently pressed modifiers */
  modifiers: Set<ModifierKey>;
  /** The main key code (non-modifier) */
  keyCode: string | null;
}

// =============================================================================
// Constants
// =============================================================================

const MODIFIER_KEY_CODES: Record<string, ModifierKey> = {
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  AltLeft: 'alt',
  AltRight: 'alt',
  MetaLeft: 'meta',
  MetaRight: 'meta',
};

// =============================================================================
// Display Helpers
// =============================================================================

function formatRecordingState(state: RecordingState, platform: Platform): string {
  const parts: string[] = [];

  // Mac order: Ctrl, Option, Shift, Command
  // Windows order: Ctrl, Shift, Alt, Win
  const modifierOrder: ModifierKey[] =
    platform === 'macos' ? ['ctrl', 'alt', 'shift', 'meta'] : ['ctrl', 'shift', 'alt', 'meta'];

  const modifierDisplay: Record<Platform, Record<ModifierKey, string>> = {
    macos: { ctrl: '\u2303', alt: '\u2325', shift: '\u21E7', meta: '\u2318' },
    windows: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' },
    linux: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Super' },
  };

  for (const mod of modifierOrder) {
    if (state.modifiers.has(mod)) {
      parts.push(modifierDisplay[platform][mod]);
    }
  }

  if (state.keyCode) {
    // Format the key code for display
    let keyDisplay = state.keyCode;
    if (keyDisplay.startsWith('Key')) {
      keyDisplay = keyDisplay.slice(3);
    } else if (keyDisplay.startsWith('Digit')) {
      keyDisplay = keyDisplay.slice(5);
    }
    parts.push(keyDisplay);
  }

  if (platform === 'macos') {
    return parts.join('');
  }
  return parts.join('+') || '...';
}

// =============================================================================
// Component
// =============================================================================

export function KeyRecorder({
  onCapture,
  onCancel,
  currentBinding,
  platform: platformProp,
}: KeyRecorderProps) {
  const { isMacOS, isLinux } = usePlatformInfo();
  const detectedPlatform: Platform = isMacOS ? 'macos' : isLinux ? 'linux' : 'windows';
  const platform = platformProp ?? detectedPlatform;
  const containerRef = useRef<HTMLDivElement>(null);

  const [recordingState, setRecordingState] = useState<RecordingState>({
    modifiers: new Set(),
    keyCode: null,
  });

  const [isCapturing, setIsCapturing] = useState(true);

  // Focus the container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Handle key down
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels
      if (e.code === 'Escape') {
        onCancel();
        return;
      }

      // Check if this is a modifier key
      const modifier = MODIFIER_KEY_CODES[e.code];
      if (modifier) {
        setRecordingState((prev) => ({
          ...prev,
          modifiers: new Set([...prev.modifiers, modifier]),
        }));
        return;
      }

      // This is a non-modifier key - capture the binding
      const modifiers = new Set<ModifierKey>();
      if (e.ctrlKey) modifiers.add('ctrl');
      if (e.shiftKey) modifiers.add('shift');
      if (e.altKey) modifiers.add('alt');
      if (e.metaKey) modifiers.add('meta');

      const binding: PhysicalKeyBinding = {
        code: e.code as PhysicalKeyBinding['code'],
        modifiers: Object.freeze([...modifiers].sort()) as readonly ModifierKey[],
      };

      setRecordingState({
        modifiers,
        keyCode: e.code,
      });

      setIsCapturing(false);

      // Small delay before calling onCapture to show the result
      setTimeout(() => {
        onCapture(binding);
      }, 200);
    },
    [onCapture, onCancel],
  );

  // Handle key up (for modifier release)
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const modifier = MODIFIER_KEY_CODES[e.code];
    if (modifier) {
      setRecordingState((prev) => {
        const newModifiers = new Set(prev.modifiers);
        newModifiers.delete(modifier);
        return { ...prev, modifiers: newModifiers };
      });
    }
  }, []);

  // Attach keyboard listeners
  useEffect(() => {
    if (!isCapturing) return;

    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('keyup', handleKeyUp);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp, isCapturing]);

  // Determine display text
  const displayText =
    recordingState.modifiers.size > 0 || recordingState.keyCode
      ? formatRecordingState(recordingState, platform)
      : 'Press a key combination...';

  const currentBindingDisplay = currentBinding ? toDisplayString(currentBinding, platform) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Current binding display */}
      {currentBindingDisplay && (
        <div className="text-body-sm text-ss-text-secondary">
          Current: <span className="font-mono">{currentBindingDisplay}</span>
        </div>
      )}

      {/* Key capture area */}
      <div
        ref={containerRef}
        tabIndex={0}
        className={[
          'w-full h-16 rounded border-2 border-dashed',
          'flex items-center justify-center',
          'text-body-lg font-mono',
          'transition-colors duration-ss-fast',
          'outline-none',
          isCapturing
            ? 'border-ss-primary bg-ss-primary/5 text-ss-text'
            : 'border-ss-success bg-ss-success/5 text-ss-success',
        ].join(' ')}
        onBlur={() => {
          // Re-focus if still capturing
          if (isCapturing) {
            containerRef.current?.focus();
          }
        }}
      >
        {displayText}
      </div>

      {/* Instructions */}
      <div className="text-caption text-ss-text-tertiary">
        Press <span className="font-mono">Escape</span> to cancel
      </div>
    </div>
  );
}
