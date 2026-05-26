# Keyboard System

Kernel-level keyboard input infrastructure for the Data OS. Normalizes raw DOM `KeyboardEvent` into platform-agnostic types, classifies input, and provides O(1) shortcut matching with cross-layout support.

**This module owns infrastructure only.** App-specific shortcut definitions, actions, display utils, and customization live in `apps/spreadsheet/src/keyboard/`.

## Architecture

```
KeyboardEvent (DOM)
       │
       ▼
┌──────────────────────┐
│ KeyboardEventProcessor│  processor.ts
│  process()           │  Normalize → KeyboardInput
│  classify()          │  Classify  → ClassifiedInput
└──────────┬───────────┘
           │
           ▼
    ┌─────────────┐
    │ ClassifiedInput │
    │  type:       │
    │   shortcut   │──→ ShortcutMatcher.match()
    │   navigation │──→ Navigation handlers
    │   action     │──→ Action handlers (Enter, Escape, Delete)
    │   character  │──→ Text input system
    │   composition│──→ IME passthrough
    │   modifier   │──→ Usually ignored
    └─────────────┘
```

## Directory Structure

```
keyboard/
├── index.ts              Barrel exports (single public API)
├── processor.ts          KeyboardEventProcessor + test helper
├── primitives/           Core types & runtime utilities
│   ├── index.ts          Re-exports everything from primitives
│   ├── physical-keys.ts  W3C physical key codes, ModifierState, Platform
│   ├── input.ts          KeyboardInput, ClassifiedInput, classifyInput()
│   ├── binding-utils.ts  Binding creation, resolution, serialization
│   └── shortcuts/
│       └── types.ts      KeyboardShortcut, contexts, priorities, categories
├── shortcuts/
│   ├── index.ts          Re-exports ShortcutMatcher
│   └── matcher.ts        O(1) dual-index shortcut matching engine
└── __tests__/
    └── processor.test.ts
```

## Key Design Decisions

### Physical Key Codes (W3C)

All key identification uses `KeyboardEvent.code` (physical position), not `KeyboardEvent.key` (character output). This means "the key in the Q position on QWERTY" is always `KeyQ`, regardless of layout. Types are comprehensive unions covering letters, digits, numpad, function, navigation, editing, punctuation, special, modifier, and IME keys.

### Dual-Index Matching

The `ShortcutMatcher` maintains two indexes for O(1) lookup:

- **`byCode`** — Indexed by physical key code. Used for positional shortcuts where the key's physical location matters (arrow keys, F-keys, digits, punctuation). `matchBy: 'code'`.

- **`byKey`** — Indexed by character + modifiers. Used for mnemonic letter shortcuts where the character matters (Ctrl+**C** for Copy, Ctrl+**B** for Bold). Works correctly across QWERTY, AZERTY, QWERTZ, Dvorak, and Colemak layouts. `matchBy: 'key'`.

### Input Classification

Every `KeyboardInput` is classified into exactly one type, checked in priority order:

1. **composition** — IME active (`isComposing`). Always passthrough.
2. **modifier-only** — Just a modifier key pressed (Shift, Ctrl, Alt, Meta, CapsLock, NumLock).
3. **shortcut** — Has Ctrl/Meta modifier, or Alt (non-Mac), or F-key, or Alt+non-letter (Mac).
4. **navigation** — Arrow keys, Tab, Home/End, PageUp/Down.
5. **action** — Enter, Escape, Delete, Backspace, Insert, Space.
6. **character** — Single printable character (letters, digits, symbols). Includes Mac Option+letter.
7. **unknown** — Fallback.

### Platform Handling

- Types define three platforms: `mac | windows | linux`
- `crossPlatformBinding()` auto-maps Ctrl→Cmd for Mac
- `resolveBinding()` picks the right binding per platform, with auto Ctrl→Meta fallback on Mac
- Platform detection from `navigator.platform`, overridable in constructor for testing

### Context Hierarchy

Shortcuts declare which contexts they're active in. The matcher supports hierarchy:

- `any` / `global` → match everywhere
- `editing` → matches `enterMode`, `editMode`, `formulaEnterMode`, `formulaEditMode`
- `formulaEditing` → matches `formulaEnterMode`, `formulaEditMode`

## Usage

```typescript
import {
  KeyboardEventProcessor,
  ShortcutMatcher,
  type KeyboardShortcut
} from '@mog/kernel/keyboard';

// 1. Create processor (once)
const processor = new KeyboardEventProcessor(); // auto-detects platform

// 2. Create matcher with shortcut definitions
const matcher = new ShortcutMatcher(shortcuts, processor.platform);

// 3. Handle keyboard events
document.addEventListener('keydown', (event) => {
  const classified = processor.processAndClassify(event);

  switch (classified.type) {
    case 'shortcut': {
      const match = matcher.match(classified.input, currentContext);
      if (match) {
        event.preventDefault();
        dispatch(match.action);
      }
      break;
    }
    case 'character':
      // Forward to text input
      break;
    case 'navigation':
      // Handle arrow keys, tab, etc.
      break;
    // ...
  }
});
```

## Test Coverage

- **processor.test.ts** — ~80 tests: normalization, classification, IME, dead keys, emoji, edge cases
- **matcher.test.ts** — ~60 tests: O(1) lookup, modifier matching, context hierarchy, platform resolution, priority, IME blocking, key repeat, rebuild, conflict detection, performance benchmarks
- **hybrid-matching.test.ts** — Layout simulation across QWERTY/AZERTY/QWERTZ/Dvorak/Colemak
