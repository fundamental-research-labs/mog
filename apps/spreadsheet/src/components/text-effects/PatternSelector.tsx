/**
 * Pattern Selector Component
 *
 * Panel for selecting TextEffect pattern fills.
 * Displays preset patterns from DrawingML with foreground/background colors.
 *
 * Fill Picker Panel (supporting component)
 */

import type { ReactElement } from 'react';
import { useCallback } from 'react';

import { ColorInput } from '@mog/shell';
import type { PatternFill, PatternType } from '@mog-sdk/contracts/text-effects';
// =============================================================================
// Types
// =============================================================================

export interface PatternSelectorProps {
  /** Current pattern configuration (undefined = use defaults) */
  pattern?: PatternFill;
  /** Callback when pattern changes */
  onChange: (pattern: Omit<PatternFill, 'type'>) => void;
}

// =============================================================================
// Pattern Definitions
// =============================================================================

interface PatternDefinition {
  id: PatternType;
  name: string;
  /** SVG pattern definition for preview */
  svgPattern: string;
}

/**
 * Common preset patterns from DrawingML.
 * These are the most commonly used patterns in Excel/TextEffect.
 */
const PRESET_PATTERNS: PatternDefinition[] = [
  // Percentage fills (dot density)
  { id: 'pct5', name: '5%', svgPattern: '5' },
  { id: 'pct10', name: '10%', svgPattern: '10' },
  { id: 'pct20', name: '20%', svgPattern: '20' },
  { id: 'pct25', name: '25%', svgPattern: '25' },
  { id: 'pct50', name: '50%', svgPattern: '50' },
  { id: 'pct75', name: '75%', svgPattern: '75' },

  // Line patterns
  { id: 'horz', name: 'Horizontal', svgPattern: 'horz' },
  { id: 'vert', name: 'Vertical', svgPattern: 'vert' },
  { id: 'dnDiag', name: 'Down Diagonal', svgPattern: 'dnDiag' },
  { id: 'upDiag', name: 'Up Diagonal', svgPattern: 'upDiag' },

  // Cross patterns
  { id: 'cross', name: 'Cross', svgPattern: 'cross' },
  { id: 'diagCross', name: 'Diagonal Cross', svgPattern: 'diagCross' },

  // Grid patterns
  { id: 'smGrid', name: 'Small Grid', svgPattern: 'smGrid' },
  { id: 'lgGrid', name: 'Large Grid', svgPattern: 'lgGrid' },

  // Check patterns
  { id: 'smCheck', name: 'Small Check', svgPattern: 'smCheck' },
  { id: 'lgCheck', name: 'Large Check', svgPattern: 'lgCheck' },
];

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_PATTERN: Omit<PatternFill, 'type'> = {
  pattern: 'pct25',
  fgColor: '#4472C4',
  bgColor: '#FFFFFF',
};

// =============================================================================
// Helper Components
// =============================================================================

interface PatternPreviewProps {
  pattern: PatternType;
  fgColor: string;
  bgColor: string;
  size?: 'sm' | 'md';
}

/**
 * Renders a visual preview of a pattern.
 * Uses CSS patterns to simulate the DrawingML pattern fills.
 */
function PatternPreview({
  pattern,
  fgColor,
  bgColor,
  size = 'sm',
}: PatternPreviewProps): ReactElement {
  const sizeClasses = size === 'sm' ? 'w-8 h-8' : 'w-full h-10';

  // Generate CSS background based on pattern type
  const getPatternStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = { backgroundColor: bgColor };

    switch (pattern) {
      // Percentage patterns (dots)
      case 'pct5':
      case 'pct10':
      case 'pct20':
      case 'pct25':
      case 'pct50':
      case 'pct75': {
        const density = parseInt(pattern.replace('pct', ''), 10);
        const dotSize = 2;
        const spacing = Math.max(4, Math.floor(100 / density));
        return {
          ...baseStyle,
          backgroundImage: `radial-gradient(${fgColor} ${dotSize}px, transparent ${dotSize}px)`,
          backgroundSize: `${spacing}px ${spacing}px`,
        };
      }

      // Horizontal lines
      case 'horz':
      case 'ltHorz':
      case 'dkHorz':
      case 'narHorz':
        return {
          ...baseStyle,
          backgroundImage: `repeating-linear-gradient(0deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px)`,
        };

      // Vertical lines
      case 'vert':
      case 'ltVert':
      case 'dkVert':
      case 'narVert':
        return {
          ...baseStyle,
          backgroundImage: `repeating-linear-gradient(90deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px)`,
        };

      // Down diagonal
      case 'dnDiag':
      case 'ltDnDiag':
      case 'dkDnDiag':
      case 'wdDnDiag':
        return {
          ...baseStyle,
          backgroundImage: `repeating-linear-gradient(45deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px)`,
        };

      // Up diagonal
      case 'upDiag':
      case 'ltUpDiag':
      case 'dkUpDiag':
      case 'wdUpDiag':
        return {
          ...baseStyle,
          backgroundImage: `repeating-linear-gradient(-45deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px)`,
        };

      // Cross
      case 'cross':
        return {
          ...baseStyle,
          backgroundImage: `
 repeating-linear-gradient(0deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px),
 repeating-linear-gradient(90deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px)
 `,
        };

      // Diagonal cross
      case 'diagCross':
        return {
          ...baseStyle,
          backgroundImage: `
 repeating-linear-gradient(45deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px),
 repeating-linear-gradient(-45deg, ${fgColor} 0px, ${fgColor} 1px, transparent 1px, transparent 4px)
 `,
        };

      // Grid
      case 'smGrid':
        return {
          ...baseStyle,
          backgroundImage: `
 linear-gradient(${fgColor} 1px, transparent 1px),
 linear-gradient(90deg, ${fgColor} 1px, transparent 1px)
 `,
          backgroundSize: '4px 4px',
        };

      case 'lgGrid':
        return {
          ...baseStyle,
          backgroundImage: `
 linear-gradient(${fgColor} 1px, transparent 1px),
 linear-gradient(90deg, ${fgColor} 1px, transparent 1px)
 `,
          backgroundSize: '8px 8px',
        };

      // Checkerboard
      case 'smCheck':
        return {
          ...baseStyle,
          backgroundImage: `
 linear-gradient(45deg, ${fgColor} 25%, transparent 25%),
 linear-gradient(-45deg, ${fgColor} 25%, transparent 25%),
 linear-gradient(45deg, transparent 75%, ${fgColor} 75%),
 linear-gradient(-45deg, transparent 75%, ${fgColor} 75%)
 `,
          backgroundSize: '4px 4px',
          backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0',
        };

      case 'lgCheck':
        return {
          ...baseStyle,
          backgroundImage: `
 linear-gradient(45deg, ${fgColor} 25%, transparent 25%),
 linear-gradient(-45deg, ${fgColor} 25%, transparent 25%),
 linear-gradient(45deg, transparent 75%, ${fgColor} 75%),
 linear-gradient(-45deg, transparent 75%, ${fgColor} 75%)
 `,
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
        };

      default:
        return baseStyle;
    }
  };

  return (
    <div className={`${sizeClasses} rounded border border-ss-border`} style={getPatternStyle()} />
  );
}

// =============================================================================
// PatternSelector Component
// =============================================================================

/**
 * Pattern Selector for TextEffect fills.
 *
 * Provides:
 * - Grid of preset patterns to choose from
 * - Foreground and background color pickers
 * - Live preview of selected pattern
 */
export function PatternSelector({ pattern, onChange }: PatternSelectorProps): ReactElement {
  // Use current pattern or defaults
  const currentPattern = pattern ?? DEFAULT_PATTERN;

  // Handle pattern type change
  const handlePatternChange = useCallback(
    (patternType: PatternType) => {
      onChange({
        ...currentPattern,
        pattern: patternType,
      });
    },
    [currentPattern, onChange],
  );

  // Handle foreground color change
  const handleFgColorChange = useCallback(
    (color: string) => {
      onChange({
        ...currentPattern,
        fgColor: color,
      });
    },
    [currentPattern, onChange],
  );

  // Handle background color change
  const handleBgColorChange = useCallback(
    (color: string) => {
      onChange({
        ...currentPattern,
        bgColor: color,
      });
    },
    [currentPattern, onChange],
  );

  return (
    <div className="space-y-4">
      {/* Pattern Grid */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-2">Pattern</label>
        <div className="grid grid-cols-4 gap-2">
          {PRESET_PATTERNS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`
 p-1 rounded border-2 transition-colors
 ${
   currentPattern.pattern === p.id
     ? 'border-ss-primary'
     : 'border-transparent hover:border-ss-border'
 }
 `}
              onClick={() => handlePatternChange(p.id)}
              title={p.name}
            >
              <PatternPreview
                pattern={p.id}
                fgColor={currentPattern.fgColor}
                bgColor={currentPattern.bgColor}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Colors */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="text-caption text-ss-text-secondary block mb-1">Foreground</label>
          <div className="flex items-center gap-2">
            <ColorInput
              value={currentPattern.fgColor}
              onChange={(e) => handleFgColorChange(e.target.value)}
              size="sm"
            />
            <span className="text-caption text-ss-text-secondary font-mono">
              {currentPattern.fgColor}
            </span>
          </div>
        </div>
        <div className="flex-1">
          <label className="text-caption text-ss-text-secondary block mb-1">Background</label>
          <div className="flex items-center gap-2">
            <ColorInput
              value={currentPattern.bgColor}
              onChange={(e) => handleBgColorChange(e.target.value)}
              size="sm"
            />
            <span className="text-caption text-ss-text-secondary font-mono">
              {currentPattern.bgColor}
            </span>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-1">Preview</label>
        <PatternPreview
          pattern={currentPattern.pattern}
          fgColor={currentPattern.fgColor}
          bgColor={currentPattern.bgColor}
          size="md"
        />
      </div>
    </div>
  );
}
