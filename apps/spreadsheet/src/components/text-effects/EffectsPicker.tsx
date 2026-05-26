/**
 * Effects Picker
 *
 * Panel for configuring TextEffect text effects including:
 * - Shadow (outer shadow with presets, color, blur, offset)
 * - Glow (color, size)
 * - Reflection (presets, transparency, size, distance)
 * - Bevel (presets, depth)
 * - 3D Rotation (presets, X/Y/Z rotation)
 *
 * ARCHITECTURE:
 * - Uses Accordion for collapsible sections
 * - Uses dispatch() for all state mutations (render isolation pattern)
 * - Uses useSelectedTextEffectDebounced() for display
 * - Reads current selection on-demand for actions via deps.accessors
 *
 * Effects Picker Panel
 */

import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';

import type {
  BevelEffect,
  BevelPreset,
  GlowEffect,
  OuterShadowEffect,
  PresetShadowType,
  ReflectionEffect,
  TextEffects,
  Transform3DEffect,
} from '@mog-sdk/contracts/text-effects';

import { dispatch } from '../../actions';
import { useSelectedTextEffectDebounced } from '../../hooks/objects/useSelectedTextEffects';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useActiveSheetId, useWorkbook } from '../../infra/context';
import {
  AccordionContent,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  Checkbox,
  Input,
  Select,
} from '@mog/shell/components/ui';

// =============================================================================
// Constants
// =============================================================================

/**
 * EMU conversion constants.
 * 1 point = 12700 EMUs
 */
const EMU_PER_POINT = 12700;

/**
 * Convert EMUs to points for display.
 */
function emuToPoints(emu: number): number {
  return Math.round(emu / EMU_PER_POINT);
}

/**
 * Convert points to EMUs for storage.
 */
function pointsToEmu(points: number): number {
  return points * EMU_PER_POINT;
}

/**
 * Shadow preset options.
 */
const SHADOW_PRESETS: { value: PresetShadowType | 'custom'; label: string }[] = [
  { value: 'custom', label: 'Custom' },
  { value: 'shdw1', label: 'Offset Diagonal Bottom Right' },
  { value: 'shdw2', label: 'Offset Bottom' },
  { value: 'shdw3', label: 'Offset Diagonal Bottom Left' },
  { value: 'shdw4', label: 'Offset Right' },
  { value: 'shdw5', label: 'Offset Center' },
  { value: 'shdw6', label: 'Offset Left' },
  { value: 'shdw10', label: 'Perspective Upper Left' },
  { value: 'shdw11', label: 'Perspective Upper Right' },
  { value: 'shdw14', label: 'Perspective Below' },
];

/**
 * Bevel preset options.
 */
const BEVEL_PRESETS: { value: BevelPreset; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'relaxedInset', label: 'Relaxed Inset' },
  { value: 'slope', label: 'Slope' },
  { value: 'cross', label: 'Cross' },
  { value: 'angle', label: 'Angle' },
  { value: 'softRound', label: 'Soft Round' },
  { value: 'convex', label: 'Convex' },
  { value: 'coolSlant', label: 'Cool Slant' },
  { value: 'divot', label: 'Divot' },
  { value: 'riblet', label: 'Riblet' },
  { value: 'hardEdge', label: 'Hard Edge' },
  { value: 'artDeco', label: 'Art Deco' },
];

/**
 * 3D rotation preset options.
 */
const ROTATION_PRESETS: {
  value: string;
  label: string;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}[] = [
  { value: 'none', label: 'No Rotation', rotationX: 0, rotationY: 0, rotationZ: 0 },
  { value: 'isometricLeft', label: 'Isometric Left', rotationX: 45, rotationY: -45, rotationZ: 0 },
  { value: 'isometricRight', label: 'Isometric Right', rotationX: 45, rotationY: 45, rotationZ: 0 },
  {
    value: 'perspectiveLeft',
    label: 'Perspective Left',
    rotationX: 0,
    rotationY: -30,
    rotationZ: 0,
  },
  {
    value: 'perspectiveRight',
    label: 'Perspective Right',
    rotationX: 0,
    rotationY: 30,
    rotationZ: 0,
  },
  {
    value: 'perspectiveBelow',
    label: 'Perspective Below',
    rotationX: 30,
    rotationY: 0,
    rotationZ: 0,
  },
  {
    value: 'perspectiveAbove',
    label: 'Perspective Above',
    rotationX: -30,
    rotationY: 0,
    rotationZ: 0,
  },
  { value: 'custom', label: 'Custom', rotationX: 0, rotationY: 0, rotationZ: 0 },
];

// =============================================================================
// Default Effect Values
// =============================================================================

/**
 * Default outer shadow effect.
 */
function getDefaultShadow(): OuterShadowEffect {
  return {
    blurRadius: pointsToEmu(4), // 4pt blur
    distance: pointsToEmu(3), // 3pt offset
    direction: 45, // 45 degrees (down-right)
    color: '#000000',
    opacity: 0.35,
  };
}

/**
 * Default glow effect.
 */
function getDefaultGlow(): GlowEffect {
  return {
    radius: pointsToEmu(5), // 5pt radius
    color: '#FFFF00', // Yellow
    opacity: 0.5,
  };
}

/**
 * Default reflection effect.
 */
function getDefaultReflection(): ReflectionEffect {
  return {
    blurRadius: pointsToEmu(0.5), // 0.5pt blur
    startOpacity: 0.52,
    endOpacity: 0,
    distance: 0,
    direction: 90,
    scaleY: -1,
  };
}

/**
 * Default bevel effect.
 */
function getDefaultBevel(): BevelEffect {
  return {
    topPreset: 'circle',
    topWidth: pointsToEmu(3),
    topHeight: pointsToEmu(3),
  };
}

/**
 * Default 3D transform effect.
 */
function getDefaultTransform3D(): Transform3DEffect {
  return {
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
  };
}

// =============================================================================
// Slider Component
// =============================================================================

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

/**
 * Simple slider component with label and value display.
 */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: SliderProps): ReactElement {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2">
      <label className="text-caption text-ss-text-secondary w-16 flex-shrink-0">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="flex-1 h-1.5 bg-ss-border rounded-full appearance-none cursor-pointer
 [&::-webkit-slider-thumb]:appearance-none
 [&::-webkit-slider-thumb]:w-3
 [&::-webkit-slider-thumb]:h-3
 [&::-webkit-slider-thumb]:bg-ss-primary
 [&::-webkit-slider-thumb]:rounded-full
 [&::-webkit-slider-thumb]:cursor-pointer"
      />
      <span className="text-caption text-ss-text-secondary w-12 text-right">
        {value}
        {unit}
      </span>
    </div>
  );
}

// =============================================================================
// Color Input Component
// =============================================================================

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

/**
 * Simple color input with swatch preview.
 */
function ColorInput({ label, value, onChange }: ColorInputProps): ReactElement {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2">
      <label className="text-caption text-ss-text-secondary w-16 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-2 flex-1">
        <input
          type="color"
          value={value}
          onChange={handleChange}
          className="w-6 h-6 rounded border border-ss-border cursor-pointer"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 !px-2 !py-1 text-caption font-mono"
          maxLength={7}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Effect Sections
// =============================================================================

interface ShadowSectionProps {
  shadow?: OuterShadowEffect;
  presetShadow?: PresetShadowType;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onChange: (shadow: OuterShadowEffect, preset?: PresetShadowType) => void;
}

/**
 * Shadow effect controls section.
 */
function ShadowSection({
  shadow,
  presetShadow,
  enabled,
  onToggle,
  onChange,
}: ShadowSectionProps): ReactElement {
  const currentShadow = shadow || getDefaultShadow();
  const [selectedPreset, setSelectedPreset] = useState<PresetShadowType | 'custom'>(
    presetShadow || 'custom',
  );

  const handlePresetChange = useCallback(
    (value: string) => {
      const preset = value as PresetShadowType | 'custom';
      setSelectedPreset(preset);
      if (preset !== 'custom') {
        // When selecting a preset, we just set the preset and let the renderer handle it
        onChange(currentShadow, preset as PresetShadowType);
      }
    },
    [currentShadow, onChange],
  );

  const handleShadowChange = useCallback(
    (updates: Partial<OuterShadowEffect>) => {
      setSelectedPreset('custom');
      onChange({ ...currentShadow, ...updates }, undefined);
    },
    [currentShadow, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-ss-text font-medium">Enable Shadow</span>
        <Checkbox checked={enabled} onChange={onToggle} />
      </div>

      {enabled && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-caption text-ss-text-secondary w-16 flex-shrink-0">Preset</label>
            <Select
              options={SHADOW_PRESETS}
              value={selectedPreset}
              onChange={handlePresetChange}
              size="sm"
              className="flex-1"
            />
          </div>

          <ColorInput
            label="Color"
            value={currentShadow.color}
            onChange={(color) => handleShadowChange({ color })}
          />

          <Slider
            label="Blur"
            value={emuToPoints(currentShadow.blurRadius)}
            min={0}
            max={100}
            unit="pt"
            onChange={(v) => handleShadowChange({ blurRadius: pointsToEmu(v) })}
          />

          <Slider
            label="Distance"
            value={emuToPoints(currentShadow.distance)}
            min={0}
            max={50}
            unit="pt"
            onChange={(v) => handleShadowChange({ distance: pointsToEmu(v) })}
          />

          <Slider
            label="Angle"
            value={currentShadow.direction}
            min={0}
            max={360}
            unit="°"
            onChange={(v) => handleShadowChange({ direction: v })}
          />

          <Slider
            label="Opacity"
            value={Math.round(currentShadow.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => handleShadowChange({ opacity: v / 100 })}
          />
        </>
      )}
    </div>
  );
}

interface GlowSectionProps {
  glow?: GlowEffect;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onChange: (glow: GlowEffect) => void;
}

/**
 * Glow effect controls section.
 */
function GlowSection({ glow, enabled, onToggle, onChange }: GlowSectionProps): ReactElement {
  const currentGlow = glow || getDefaultGlow();

  const handleGlowChange = useCallback(
    (updates: Partial<GlowEffect>) => {
      onChange({ ...currentGlow, ...updates });
    },
    [currentGlow, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-ss-text font-medium">Enable Glow</span>
        <Checkbox checked={enabled} onChange={onToggle} />
      </div>

      {enabled && (
        <>
          <ColorInput
            label="Color"
            value={currentGlow.color}
            onChange={(color) => handleGlowChange({ color })}
          />

          <Slider
            label="Size"
            value={emuToPoints(currentGlow.radius)}
            min={0}
            max={50}
            unit="pt"
            onChange={(v) => handleGlowChange({ radius: pointsToEmu(v) })}
          />

          <Slider
            label="Opacity"
            value={Math.round(currentGlow.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => handleGlowChange({ opacity: v / 100 })}
          />
        </>
      )}
    </div>
  );
}

interface ReflectionSectionProps {
  reflection?: ReflectionEffect;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onChange: (reflection: ReflectionEffect) => void;
}

/**
 * Reflection effect controls section.
 */
function ReflectionSection({
  reflection,
  enabled,
  onToggle,
  onChange,
}: ReflectionSectionProps): ReactElement {
  const currentReflection = reflection || getDefaultReflection();

  const handleReflectionChange = useCallback(
    (updates: Partial<ReflectionEffect>) => {
      onChange({ ...currentReflection, ...updates });
    },
    [currentReflection, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-ss-text font-medium">Enable Reflection</span>
        <Checkbox checked={enabled} onChange={onToggle} />
      </div>

      {enabled && (
        <>
          <Slider
            label="Transparency"
            value={Math.round((1 - currentReflection.startOpacity) * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => handleReflectionChange({ startOpacity: 1 - v / 100 })}
          />

          <Slider
            label="Size"
            value={Math.abs(currentReflection.scaleY ?? 1) * 100}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => handleReflectionChange({ scaleY: -(v / 100) })}
          />

          <Slider
            label="Distance"
            value={emuToPoints(currentReflection.distance)}
            min={0}
            max={20}
            unit="pt"
            onChange={(v) => handleReflectionChange({ distance: pointsToEmu(v) })}
          />

          <Slider
            label="Blur"
            value={emuToPoints(currentReflection.blurRadius)}
            min={0}
            max={10}
            step={0.5}
            unit="pt"
            onChange={(v) => handleReflectionChange({ blurRadius: pointsToEmu(v) })}
          />
        </>
      )}
    </div>
  );
}

interface BevelSectionProps {
  bevel?: BevelEffect;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onChange: (bevel: BevelEffect) => void;
}

/**
 * Bevel effect controls section.
 */
function BevelSection({ bevel, enabled, onToggle, onChange }: BevelSectionProps): ReactElement {
  const currentBevel = bevel || getDefaultBevel();

  const handleBevelChange = useCallback(
    (updates: Partial<BevelEffect>) => {
      onChange({ ...currentBevel, ...updates });
    },
    [currentBevel, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-ss-text font-medium">Enable Bevel</span>
        <Checkbox checked={enabled} onChange={onToggle} />
      </div>

      {enabled && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-caption text-ss-text-secondary w-16 flex-shrink-0">Preset</label>
            <Select
              options={BEVEL_PRESETS}
              value={currentBevel.topPreset || 'circle'}
              onChange={(value) => handleBevelChange({ topPreset: value as BevelPreset })}
              size="sm"
              className="flex-1"
            />
          </div>

          <Slider
            label="Depth"
            value={emuToPoints(currentBevel.topHeight || 0)}
            min={0}
            max={20}
            unit="pt"
            onChange={(v) =>
              handleBevelChange({
                topHeight: pointsToEmu(v),
                topWidth: pointsToEmu(v),
              })
            }
          />
        </>
      )}
    </div>
  );
}

interface Transform3DSectionProps {
  transform?: Transform3DEffect;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onChange: (transform: Transform3DEffect) => void;
}

/**
 * 3D rotation effect controls section.
 */
function Transform3DSection({
  transform,
  enabled,
  onToggle,
  onChange,
}: Transform3DSectionProps): ReactElement {
  const currentTransform = transform || getDefaultTransform3D();
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');

  const handlePresetChange = useCallback(
    (value: string) => {
      const preset = ROTATION_PRESETS.find((p) => p.value === value);
      if (preset) {
        setSelectedPreset(preset.value);
        if (preset.value !== 'custom') {
          onChange({
            ...currentTransform,
            rotationX: preset.rotationX,
            rotationY: preset.rotationY,
            rotationZ: preset.rotationZ,
          });
        }
      }
    },
    [currentTransform, onChange],
  );

  const handleTransformChange = useCallback(
    (updates: Partial<Transform3DEffect>) => {
      setSelectedPreset('custom');
      onChange({ ...currentTransform, ...updates });
    },
    [currentTransform, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-ss-text font-medium">Enable 3D Rotation</span>
        <Checkbox checked={enabled} onChange={onToggle} />
      </div>

      {enabled && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-caption text-ss-text-secondary w-16 flex-shrink-0">Preset</label>
            <Select
              options={ROTATION_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
              value={selectedPreset}
              onChange={handlePresetChange}
              size="sm"
              className="flex-1"
            />
          </div>

          <Slider
            label="X Rotation"
            value={currentTransform.rotationX}
            min={-90}
            max={90}
            unit="°"
            onChange={(v) => handleTransformChange({ rotationX: v })}
          />

          <Slider
            label="Y Rotation"
            value={currentTransform.rotationY}
            min={-90}
            max={90}
            unit="°"
            onChange={(v) => handleTransformChange({ rotationY: v })}
          />

          <Slider
            label="Z Rotation"
            value={currentTransform.rotationZ}
            min={0}
            max={360}
            unit="°"
            onChange={(v) => handleTransformChange({ rotationZ: v })}
          />
        </>
      )}
    </div>
  );
}

// =============================================================================
// EffectsPicker Component
// =============================================================================

/**
 * EffectsPicker - Panel for configuring TextEffect text effects.
 *
 * Shows collapsible sections for each effect type:
 * - Shadow
 * - Glow
 * - Reflection
 * - Bevel
 * - 3D Rotation
 *
 * Uses dispatch pattern for all state mutations.
 * Uses useSelectedTextEffectDebounced() for display to prevent re-renders during drag.
 * Reads current selection on-demand via deps.accessors for action handlers.
 */
export function EffectsPicker(): ReactElement {
  // Action dependencies for dispatch
  const deps = useActionDependencies();
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();

  // Use debounced selection for display to prevent re-renders during drag
  const selectedTextEffect = useSelectedTextEffectDebounced();
  // Cast to TextEffects from effects.ts (types.ts has a stub with 'unknown' types)
  const currentEffects = (selectedTextEffect?.textEffects?.effects ?? {}) as TextEffects;

  // Track which sections are expanded
  const [expandedSections, setExpandedSections] = useState<string[]>(['shadow']);

  /**
   * Handle effects change.
   * Reads current selection AND current effects on-demand to avoid stale closure issues.
   * The debounced currentEffects is only used for display, not for merging updates.
   */
  const handleEffectsChange = useCallback(
    async (updates: Partial<TextEffects>) => {
      // Read current selection on-demand from object accessor
      const objectId = deps.accessors.object.getFirstSelectedId();
      if (!objectId) return;

      // Read current effects on-demand from the Worksheet API (TextEffect handle)
      // This avoids stale closure issues with the debounced currentEffects value
      const ws = workbook.getSheetById(activeSheetId);
      const textEffectsHandle = await ws.textEffects.get(objectId);
      if (!textEffectsHandle) return;

      const textBoxData = await textEffectsHandle.getData();
      if (!textBoxData.textEffects) return;

      // Merge updates with fresh current effects (not debounced)
      const freshEffects = textBoxData.textEffects.effects ?? {};

      dispatch('UPDATE_TEXT_EFFECT_EFFECTS', deps, {
        objectId,
        effects: { ...freshEffects, ...updates },
      });
    },
    [deps, workbook, activeSheetId],
  );

  // Shadow handlers
  const handleShadowToggle = useCallback(
    (enabled: boolean) => {
      handleEffectsChange({
        outerShadow: enabled ? getDefaultShadow() : undefined,
        presetShadow: undefined,
      });
    },
    [handleEffectsChange],
  );

  const handleShadowChange = useCallback(
    (shadow: OuterShadowEffect, preset?: PresetShadowType) => {
      handleEffectsChange({
        outerShadow: shadow,
        presetShadow: preset,
      });
    },
    [handleEffectsChange],
  );

  // Glow handlers
  const handleGlowToggle = useCallback(
    (enabled: boolean) => {
      handleEffectsChange({
        glow: enabled ? getDefaultGlow() : undefined,
      });
    },
    [handleEffectsChange],
  );

  const handleGlowChange = useCallback(
    (glow: GlowEffect) => {
      handleEffectsChange({ glow });
    },
    [handleEffectsChange],
  );

  // Reflection handlers
  const handleReflectionToggle = useCallback(
    (enabled: boolean) => {
      handleEffectsChange({
        reflection: enabled ? getDefaultReflection() : undefined,
      });
    },
    [handleEffectsChange],
  );

  const handleReflectionChange = useCallback(
    (reflection: ReflectionEffect) => {
      handleEffectsChange({ reflection });
    },
    [handleEffectsChange],
  );

  // Bevel handlers
  const handleBevelToggle = useCallback(
    (enabled: boolean) => {
      handleEffectsChange({
        bevel: enabled ? getDefaultBevel() : undefined,
      });
    },
    [handleEffectsChange],
  );

  const handleBevelChange = useCallback(
    (bevel: BevelEffect) => {
      handleEffectsChange({ bevel });
    },
    [handleEffectsChange],
  );

  // 3D Rotation handlers
  const handleTransform3DToggle = useCallback(
    (enabled: boolean) => {
      handleEffectsChange({
        transform3D: enabled ? getDefaultTransform3D() : undefined,
      });
    },
    [handleEffectsChange],
  );

  const handleTransform3DChange = useCallback(
    (transform3D: Transform3DEffect) => {
      handleEffectsChange({ transform3D });
    },
    [handleEffectsChange],
  );

  return (
    <div className="p-3 w-80 max-h-[480px] overflow-y-auto bg-ss-surface rounded-ss-md border border-ss-border">
      <h3 className="text-body font-medium text-ss-text mb-3">Text Effects</h3>

      <AccordionRoot
        type="multiple"
        value={expandedSections}
        onValueChange={setExpandedSections as (value: string | string[]) => void}
      >
        {/* Shadow Section */}
        <AccordionItem value="shadow">
          <AccordionTrigger>Shadow</AccordionTrigger>
          <AccordionContent>
            <ShadowSection
              shadow={currentEffects.outerShadow}
              presetShadow={currentEffects.presetShadow}
              enabled={!!currentEffects.outerShadow || !!currentEffects.presetShadow}
              onToggle={handleShadowToggle}
              onChange={handleShadowChange}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Glow Section */}
        <AccordionItem value="glow">
          <AccordionTrigger>Glow</AccordionTrigger>
          <AccordionContent>
            <GlowSection
              glow={currentEffects.glow}
              enabled={!!currentEffects.glow}
              onToggle={handleGlowToggle}
              onChange={handleGlowChange}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Reflection Section */}
        <AccordionItem value="reflection">
          <AccordionTrigger>Reflection</AccordionTrigger>
          <AccordionContent>
            <ReflectionSection
              reflection={currentEffects.reflection}
              enabled={!!currentEffects.reflection}
              onToggle={handleReflectionToggle}
              onChange={handleReflectionChange}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Bevel Section */}
        <AccordionItem value="bevel">
          <AccordionTrigger>Bevel</AccordionTrigger>
          <AccordionContent>
            <BevelSection
              bevel={currentEffects.bevel}
              enabled={!!currentEffects.bevel}
              onToggle={handleBevelToggle}
              onChange={handleBevelChange}
            />
          </AccordionContent>
        </AccordionItem>

        {/* 3D Rotation Section */}
        <AccordionItem value="transform3d">
          <AccordionTrigger>3-D Rotation</AccordionTrigger>
          <AccordionContent>
            <Transform3DSection
              transform={currentEffects.transform3D}
              enabled={!!currentEffects.transform3D}
              onToggle={handleTransform3DToggle}
              onChange={handleTransform3DChange}
            />
          </AccordionContent>
        </AccordionItem>
      </AccordionRoot>
    </div>
  );
}
