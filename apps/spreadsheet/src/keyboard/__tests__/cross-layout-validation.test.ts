/**
 * Cross-Layout Shortcut Definition Validation Tests
 *
 * These tests validate the KEYBOARD_SHORTCUTS definitions themselves,
 * ensuring that all matchBy/expectedCharacter fields are correct and
 * consistent. This catches configuration errors at test time rather
 * than at runtime on non-QWERTY keyboards.
 *
 * The tests verify:
 * - Every shortcut has a matchBy field set
 * - matchBy: 'key' shortcuts always have an expectedCharacter
 * - matchBy: 'code' shortcuts never have an expectedCharacter
 * - matchBy classification is consistent with inferMatchBy utility
 * - expectedCharacter values match the letter from the key code
 * - No duplicate shortcut IDs exist
 * - All shortcut IDs follow naming conventions
 */

import { extractCharacterFromCode, inferMatchBy } from '@mog-sdk/kernel/keyboard';
import { KEYBOARD_SHORTCUTS, validateShortcutIds } from '../definitions';

// =============================================================================
// matchBy Field Validation
// =============================================================================

describe('Shortcut definitions validation', () => {
  describe('matchBy field is set on all shortcuts', () => {
    it('all shortcuts have matchBy set to either "key" or "code"', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy !== 'key' && s.matchBy !== 'code') {
          failures.push(`${s.id}: matchBy is "${s.matchBy}" (expected "key" or "code")`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} shortcuts have invalid matchBy:\n` + failures.join('\n'),
        );
      }
    });

    it('matchBy is defined (not undefined or null)', () => {
      for (const s of KEYBOARD_SHORTCUTS) {
        expect(s.matchBy).toBeDefined();
        expect(['key', 'code']).toContain(s.matchBy);
      }
    });
  });

  // ===========================================================================
  // expectedCharacter Validation for matchBy: 'key'
  // ===========================================================================

  describe('matchBy: "key" shortcuts have correct expectedCharacter', () => {
    it('all matchBy:key shortcuts have expectedCharacter defined', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'key') {
          if (s.expectedCharacter === undefined || s.expectedCharacter === null) {
            failures.push(`${s.id}: matchBy is "key" but expectedCharacter is missing`);
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} matchBy:"key" shortcuts lack expectedCharacter:\n` +
            failures.join('\n'),
        );
      }
    });

    it('expectedCharacter is exactly one character long', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'key' && s.expectedCharacter !== undefined) {
          if (s.expectedCharacter.length !== 1) {
            failures.push(
              `${s.id}: expectedCharacter "${s.expectedCharacter}" has length ${s.expectedCharacter.length} (expected 1)`,
            );
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} shortcuts have wrong expectedCharacter length:\n` +
            failures.join('\n'),
        );
      }
    });

    it('expectedCharacter is lowercase', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'key' && s.expectedCharacter !== undefined) {
          if (s.expectedCharacter !== s.expectedCharacter.toLowerCase()) {
            failures.push(`${s.id}: expectedCharacter "${s.expectedCharacter}" is not lowercase`);
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} shortcuts have non-lowercase expectedCharacter:\n` +
            failures.join('\n'),
        );
      }
    });
  });

  // ===========================================================================
  // matchBy: 'code' should NOT have expectedCharacter
  // ===========================================================================

  describe('matchBy: "code" shortcuts do not have expectedCharacter', () => {
    it('matchBy:code shortcuts do NOT have expectedCharacter set', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'code') {
          if (s.expectedCharacter !== undefined) {
            failures.push(
              `${s.id}: matchBy is "code" but expectedCharacter is "${s.expectedCharacter}" (should be undefined)`,
            );
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} matchBy:"code" shortcuts have unexpected expectedCharacter:\n` +
            failures.join('\n'),
        );
      }
    });
  });

  // ===========================================================================
  // matchBy Classification Consistency
  // ===========================================================================

  describe('matchBy classification consistency', () => {
    it('matchBy classification matches inferMatchBy for standard cases', () => {
      const overrides: string[] = [];
      const mismatches: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        const binding = s.bindings.default;
        const inferred = inferMatchBy(binding.code, binding.modifiers);

        if (s.matchBy !== inferred) {
          // Known acceptable overrides:
          // - Bare letter keys in drawing/tool contexts use matchBy: 'code'
          // even though inferMatchBy would say 'key' (positional muscle memory)
          // - Some shortcuts intentionally override the inference
          const isDrawingContext = s.contexts.includes('drawing');
          const isDiagramContext = s.contexts.includes('diagramNodeSelected');
          const isBareLetterKey = /^Key[A-Z]$/.test(binding.code) && binding.modifiers.length === 0;

          // open-search-box: default binding is Alt+KeyQ (infers 'key') but Mac
          // binding is Cmd+F6 (an F-key). matchBy must be 'code' so that the Mac
          // binding can match physically. Code-based matching works for both platforms.
          const isCrossPlatformCodeOverride =
            s.id === 'open-search-box' && s.matchBy === 'code' && inferred === 'key';

          // Alt+letter shortcuts use matchBy:'code' because on Mac, the Option (Alt)
          // key modifies character output (e.g., Option+H produces a special character,
          // not 'h'). inferMatchBy returns 'key' for letter keys with modifiers, but
          // Alt specifically breaks character-based matching on Mac. This also applies
          // to Ctrl+Alt combinations where Alt is present (e.g., reapply-filter).
          const isAltLetterOverride =
            s.matchBy === 'code' &&
            inferred === 'key' &&
            /^Key[A-Z]$/.test(binding.code) &&
            binding.modifiers.includes('alt');

          if (isBareLetterKey && (isDrawingContext || isDiagramContext)) {
            // Acceptable override: bare letters in drawing/tool contexts
            overrides.push(
              `${s.id}: override accepted (bare letter in drawing context, matchBy: ${s.matchBy}, inferred: ${inferred})`,
            );
          } else if (isCrossPlatformCodeOverride) {
            // Acceptable override: Mac uses F-key, so matchBy:'code' is required
            overrides.push(
              `${s.id}: override accepted (Mac binding uses F-key, matchBy: ${s.matchBy}, inferred: ${inferred})`,
            );
          } else if (isAltLetterOverride) {
            // Acceptable override: Alt+letter on Mac produces special characters
            overrides.push(
              `${s.id}: override accepted (Alt+letter on Mac alters character output, matchBy: ${s.matchBy}, inferred: ${inferred})`,
            );
          } else {
            mismatches.push(
              `${s.id}: matchBy is "${s.matchBy}" but inferMatchBy says "${inferred}" (code: ${binding.code}, mods: [${binding.modifiers.join(',')}], contexts: [${s.contexts.join(',')}])`,
            );
          }
        }
      }

      // Log overrides for visibility (not failures)
      if (overrides.length > 0) {
        // These are acceptable overrides, just informational
      }

      // Mismatches indicate potential bugs: matchBy is set to a value that
      // differs from what inferMatchBy would compute. If a shortcut legitimately
      // needs an override (e.g., bare letter keys in drawing context), add it to
      // the exception list above.
      if (mismatches.length > 0) {
        throw new Error(
          `${mismatches.length} shortcuts have unexpected matchBy override:\n` +
            mismatches.join('\n'),
        );
      }
    });
  });

  // ===========================================================================
  // expectedCharacter Matches Code
  // ===========================================================================

  describe('expectedCharacter matches the letter from the key code', () => {
    it('expectedCharacter matches extractCharacterFromCode for letter keys', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'key' && s.expectedCharacter) {
          const charFromCode = extractCharacterFromCode(s.bindings.default.code);
          if (charFromCode !== undefined && charFromCode !== s.expectedCharacter) {
            failures.push(
              `${s.id}: expectedCharacter is "${s.expectedCharacter}" but code "${s.bindings.default.code}" implies "${charFromCode}"`,
            );
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} shortcuts have mismatched expectedCharacter:\n` + failures.join('\n'),
        );
      }
    });

    it('matchBy:key shortcuts with letter codes have matching expectedCharacter', () => {
      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'key' && s.expectedCharacter) {
          const code = s.bindings.default.code;
          const isLetterCode = /^Key[A-Z]$/.test(code);
          if (isLetterCode) {
            const expectedFromCode = code.replace('Key', '').toLowerCase();
            expect(s.expectedCharacter).toBe(expectedFromCode);
          }
        }
      }
    });
  });

  // ===========================================================================
  // Unique IDs
  // ===========================================================================

  describe('Shortcut ID uniqueness', () => {
    it('no duplicate shortcut IDs', () => {
      const ids = KEYBOARD_SHORTCUTS.map((s) => s.id);
      const uniqueIds = new Set(ids);

      if (ids.length !== uniqueIds.size) {
        const duplicates = validateShortcutIds();
        throw new Error(`Found ${duplicates.length} duplicate IDs:\n` + duplicates.join('\n'));
      }

      expect(ids.length).toBe(uniqueIds.size);
    });

    it('all shortcut IDs are non-empty strings', () => {
      for (const s of KEYBOARD_SHORTCUTS) {
        expect(typeof s.id).toBe('string');
        expect(s.id.length).toBeGreaterThan(0);
      }
    });

    it('all shortcut IDs use valid characters (lowercase, digits, hyphens)', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        // Allow dot notation (e.g., 'file.save') and hyphens (e.g., 'move-up')
        if (!/^[a-z0-9][a-z0-9.\-]*[a-z0-9]$/.test(s.id) && s.id.length > 1) {
          failures.push(
            `${s.id}: ID does not match expected pattern (lowercase letters, digits, hyphens, dots)`,
          );
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} shortcuts have non-standard IDs:\n` + failures.join('\n'),
        );
      }
    });
  });

  // ===========================================================================
  // Category and Context Coverage
  // ===========================================================================

  describe('Shortcut structural integrity', () => {
    it('all shortcuts have at least one context', () => {
      for (const s of KEYBOARD_SHORTCUTS) {
        expect(s.contexts.length).toBeGreaterThan(0);
      }
    });

    it('all shortcuts have a valid category', () => {
      const validCategories = [
        'navigation',
        'selection',
        'editing',
        'formatting',
        'clipboard',
        'formula',
        'comments',
        'data',
        'view',
        'file',
        'workbook',
        'object',
        'accessibility',
      ];

      for (const s of KEYBOARD_SHORTCUTS) {
        expect(validCategories).toContain(s.category);
      }
    });

    it('all shortcuts have a valid priority', () => {
      const validPriorities = ['critical', 'high', 'medium', 'low'];

      for (const s of KEYBOARD_SHORTCUTS) {
        expect(validPriorities).toContain(s.priority);
      }
    });

    it('all shortcuts have a valid muscleMemory level', () => {
      const validLevels = ['essential', 'common', 'occasional', 'rare'];

      for (const s of KEYBOARD_SHORTCUTS) {
        expect(validLevels).toContain(s.muscleMemory);
      }
    });

    it('all shortcuts have a non-empty action string', () => {
      for (const s of KEYBOARD_SHORTCUTS) {
        expect(typeof s.action).toBe('string');
        expect(s.action.length).toBeGreaterThan(0);
      }
    });

    it('all shortcuts have a non-empty description', () => {
      for (const s of KEYBOARD_SHORTCUTS) {
        expect(typeof s.description).toBe('string');
        expect(s.description.length).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // Statistics and Coverage Report
  // ===========================================================================

  describe('Shortcut registry statistics', () => {
    it('should have a reasonable number of shortcuts (200+)', () => {
      expect(KEYBOARD_SHORTCUTS.length).toBeGreaterThanOrEqual(200);
    });

    it('should have both matchBy: "key" and matchBy: "code" shortcuts', () => {
      const keyCount = KEYBOARD_SHORTCUTS.filter((s) => s.matchBy === 'key').length;
      const codeCount = KEYBOARD_SHORTCUTS.filter((s) => s.matchBy === 'code').length;

      // We expect a significant number of both types
      expect(keyCount).toBeGreaterThan(20);
      expect(codeCount).toBeGreaterThan(50);
    });

    it('should have shortcuts in every category', () => {
      const categories = new Set(KEYBOARD_SHORTCUTS.map((s) => s.category));

      // We expect all major categories to be represented
      expect(categories.has('navigation')).toBe(true);
      expect(categories.has('selection')).toBe(true);
      expect(categories.has('editing')).toBe(true);
      expect(categories.has('formatting')).toBe(true);
      expect(categories.has('clipboard')).toBe(true);
    });

    it('should have essential muscle memory shortcuts', () => {
      const essentialIds = KEYBOARD_SHORTCUTS.filter((s) => s.muscleMemory === 'essential').map(
        (s) => s.id,
      );

      // These are the absolute must-have shortcuts
      const expectedEssentials = ['copy', 'cut', 'paste', 'undo'];
      for (const id of expectedEssentials) {
        expect(essentialIds).toContain(id);
      }
    });
  });

  // ===========================================================================
  // Cross-layout safety: matchBy:key shortcuts have correct key codes
  // ===========================================================================

  describe('Cross-layout safety', () => {
    it('all matchBy:key shortcuts use letter key codes (KeyA-KeyZ)', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'key') {
          const code = s.bindings.default.code;
          const isLetterCode = /^Key[A-Z]$/.test(code);
          if (!isLetterCode) {
            failures.push(`${s.id}: matchBy is "key" but code is "${code}" (expected KeyA-KeyZ)`);
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} matchBy:"key" shortcuts use non-letter codes:\n` +
            failures.join('\n'),
        );
      }
    });

    it('all matchBy:key shortcuts have at least one command modifier (ctrl, meta, or alt)', () => {
      const failures: string[] = [];

      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'key') {
          const mods = s.bindings.default.modifiers;
          const hasCommandMod =
            mods.includes('ctrl') || mods.includes('meta') || mods.includes('alt');

          if (!hasCommandMod) {
            // This is allowed for drawing context bare letter keys
            // but those should be matchBy: 'code'
            failures.push(
              `${s.id}: matchBy is "key" but no command modifier present (mods: [${mods.join(',')}])`,
            );
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} matchBy:"key" shortcuts lack command modifiers:\n` +
            failures.join('\n'),
        );
      }
    });

    it('matchBy:code shortcuts with non-letter codes do not need expectedCharacter', () => {
      for (const s of KEYBOARD_SHORTCUTS) {
        if (s.matchBy === 'code') {
          const code = s.bindings.default.code;
          const isLetterCode = /^Key[A-Z]$/.test(code);
          if (!isLetterCode) {
            expect(s.expectedCharacter).toBeUndefined();
          }
        }
      }
    });
  });
});
