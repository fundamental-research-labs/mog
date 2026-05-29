/**
 * FormulasIcons.tsx
 *
 * Icons for the Formulas tab ribbon.
 * All icons sourced from @mog/icons - single source of truth.
 *
 * Icons included:
 * - Function category icons (F1)
 * - Defined Names icons (F2)
 * - Formula Auditing icons (F3)
 * - Calculation icons (F4)
 */

import {
  BranchForkSvg,
  CalculatorSvg,
  CalendarSvg,
  CellEditSvg,
  ClockSvg,
  DocumentSearchSvg,
  FormulaSvg,
  MoneySvg,
  MoreHorizontalSvg,
  ProhibitedSvg,
  StepOverSvg,
  TagSvg,
  TextDescriptionSvg,
  WarningSvg,
} from '@mog/icons';

import type { CSSProperties, ComponentType, SVGProps } from 'react';

// =============================================================================
// Types & Utilities
// =============================================================================

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const iconStyle: CSSProperties = { width: 16, height: 16 };

function createIcon(Svg: SvgComponent) {
  return function Icon() {
    return <Svg style={iconStyle} />;
  };
}

// =============================================================================
// Calculation Icons (F4)
// =============================================================================

export const CalculateSheetIcon = createIcon(CalculatorSvg);

// =============================================================================
// Function Category Icons (F1)
// =============================================================================

export const RecentlyUsedIcon = createIcon(ClockSvg);
export const FinancialFunctionIcon = createIcon(MoneySvg);
export const LogicalFunctionIcon = createIcon(BranchForkSvg);
export const TextFunctionIcon = createIcon(TextDescriptionSvg);
export const DateTimeFunctionIcon = createIcon(CalendarSvg);
export const LookupFunctionIcon = createIcon(DocumentSearchSvg);
export const MathTrigFunctionIcon = createIcon(FormulaSvg);
export const MoreFunctionsIcon = createIcon(MoreHorizontalSvg);

// =============================================================================
// Defined Names Icons (F2)
// =============================================================================

export const DefineNameIcon = createIcon(TagSvg);
export const CreateFromSelectionIcon = createIcon(CellEditSvg);
export const UseInFormulaIcon = createIcon(FormulaSvg);

// =============================================================================
// Formula Auditing Icons (F3)
// =============================================================================

export const RemoveArrowsIcon = createIcon(ProhibitedSvg);
export const ErrorCheckingIcon = createIcon(WarningSvg);
export const EvaluateFormulaIcon = createIcon(StepOverSvg);
export const WatchWindowIcon = createIcon(DocumentSearchSvg);
