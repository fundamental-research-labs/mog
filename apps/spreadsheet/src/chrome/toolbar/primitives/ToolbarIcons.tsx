/**
 * Toolbar Icons
 *
 * Icon components for the spreadsheet toolbar and ribbons.
 * All icons are sourced from @mog/icons - the single source of truth.
 *
 * Architecture:
 * - Raw SVGs live in @mog/icons (icons/src/*.svg)
 * - This file provides sized wrapper components for toolbar use
 * - No external icon dependencies (Fluent UI removed)
 */

import {
  AccessibilitySvg,
  // Misc
  AddSvg,
  AdvancedFilterSvg,
  AlignBottomSvg,
  AlignCenterSvg,
  // Alignment
  AlignLeftSvg,
  AlignMiddleSvg,
  AlignRightSvg,
  AlignTopSvg,
  AngleClockwiseSvg,
  AngleCounterclockwiseSvg,
  ArrangeAllSvg,
  ArrowDownSvg,
  ArrowLeftSvg,
  ArrowRightSvg,
  ArrowUpSvg,
  AutosumSvg,
  // Text Formatting
  BoldSvg,
  // Borders
  BorderAllSvg,
  BorderBottomSvg,
  BorderHorizontalSvg,
  BorderLeftSvg,
  BorderNoneSvg,
  BorderOutsideSvg,
  BorderRightSvg,
  BorderThickOutsideSvg,
  BorderTopSvg,
  BorderVerticalSvg,
  BringForwardSvg,
  BringToFrontSvg,
  CellsMergeSvg,
  CellsSplitSvg,
  ChartAreaSvg,
  ChartBarSvg,
  ChartBubbleSvg,
  ChartColumnSvg,
  ChartComboSvg,
  ChartDoughnutSvg,
  ChartFunnelSvg,
  ChartLineSvg,
  ChartPieSvg,
  ChartRadarSvg,
  ChartScatterSvg,
  ChartStockSvg,
  // Charts
  ChartSvg,
  ChartWaterfallSvg,
  CheckSvg,
  CheckmarkCircleSvg,
  // UI Elements
  ChevronDownSvg,
  ChevronRightSvg,
  ChevronUpSvg,
  CircleSvg,
  ClearCommentsSvg,
  ClearContentsSvg,
  ClearFilterSvg,
  ClearFormattingSvg,
  CloseSvg,
  ColumnWidthSvg,
  CommaStyleSvg,
  // Comments
  CommentSvg,
  ConditionalFormatSvg,
  ConnectionsSvg,
  ConsolidateSvg,
  ConvertToRangeSvg,
  CopySvg,
  CurrencySvg,
  CustomViewsSvg,
  // Clipboard
  CutSvg,
  DataLineSvg,
  DecimalDecreaseSvg,
  DecimalIncreaseSvg,
  DecreaseIndentSvg,
  DeleteColumnSvg,
  DeleteCommentSvg,
  DeleteRowSvg,
  DeleteSheetSvg,
  DeleteSvg,
  DiamondSvg,
  // File Operations
  DownloadSvg,
  DropdownArrowSvg,
  EquationSvg,
  EraserSvg,
  FillColorSvg,
  FillSeriesSvg,
  FilterSvg,
  FlashFillSvg,
  // Colors
  FontColorSvg,
  FontSizeDecreaseSvg,
  FontSizeIncreaseSvg,
  FontSizeSvg,
  FontSvg,
  FormsSvg,
  // View (Window/Display)
  FormulaBarSvg,
  // Formulas
  FormulaSvg,
  FreezeRowSvg,
  GetDataSvg,
  GoToSvg,
  GridSvg,
  GroupListSvg,
  HeaderFooterSvg,
  HideColumnSvg,
  HideRowSvg,
  HideSvg,
  HighlighterSvg,
  IconsSvg,
  // Insert & Illustrations
  ImageSvg,
  IncreaseIndentSvg,
  InkToMathSvg,
  InkToShapeSvg,
  InsertColumnSvg,
  InsertRowSvg,
  InsertSheetSvg,
  ItalicSvg,
  LineSvg,
  LinkSvg,
  LockSvg,
  MacrosSvg,
  MarginsSvg,
  MergeAcrossSvg,
  MergeCenterSvg,
  Model3DSvg,
  NameManagerSvg,
  NewCommentSvg,
  NewWindowSvg,
  NextCommentSvg,
  NoteSvg,
  NumberSvg,
  ObjectSvg,
  OrientationSvg,
  PageBreaksSvg,
  PageFitSvg,
  PageLayoutViewSvg,
  PaintBrushSvg,
  PasteFormattingSvg,
  PasteFormulasSvg,
  PasteSpecialSvg,
  PasteSvg,
  PasteValuesSvg,
  PdfSvg,
  // Drawing
  PenSvg,
  PercentSvg,
  PivotChartSvg,
  PivotTableSvg,
  PlaySvg,
  PreviousCommentSvg,
  PrintSvg,
  PrintTitlesSvg,
  ProtectWorkbookSvg,
  ReadOnlySvg,
  ReapplyFilterSvg,
  RecommendedChartsSvg,
  RecordMacroSvg,
  RedoSvg,
  RelativeReferencesSvg,
  RemoveDuplicatesSvg,
  RotateTextDownSvg,
  RotateTextUpSvg,
  RoundedRectSvg,
  RowHeightSvg,
  RulerSvg,
  SaveSvg,
  ScaleHeightSvg,
  ScaleWidthSvg,
  ScreenshotSvg,
  SearchSvg,
  SelectAllSvg,
  SelectObjectSvg,
  SelectObjectsSvg,
  SendBackwardSvg,
  SendToBackSvg,
  SettingsSvg,
  // Shapes
  ShapesSvg,
  ShowAllCommentsSvg,
  ShowHideCommentSvg,
  SlicerSvg,
  DiagramSvg,
  // Sort & Filter
  SortAscendingSvg,
  SortDescendingSvg,
  SparklineColumnSvg,
  SparklineLineSvg,
  SparklineWinlossSvg,
  SpellCheckSvg,
  SpinnerSvg,
  SplitViewSvg,
  SquareSvg,
  StarSvg,
  StrikethroughSvg,
  SubtractSvg,
  SwitchWindowsSvg,
  SyncSvg,
  // Data & Tables
  TableAddSvg,
  TableDismissSvg,
  TableEditSvg,
  TextOrientationSvg,
  TextToColumnsSvg,
  TextWrapSvg,
  TextboxSvg,
  ThemeColorsSvg,
  ThemeFontsSvg,
  ThemesSvg,
  ThesaurusSvg,
  TimelineSvg,
  TraceDependentsSvg,
  TracePrecedentsSvg,
  TriangleSvg,
  UnderlineSvg,
  // Navigation
  UndoSvg,
  UnhideSvg,
  VerticalTextSvg,
  TextEffectSvg,
  WorkbookStatisticsSvg,
  // View & Zoom
  ZoomInSvg,
  ZoomOutSvg,
  // Wrapper utilities
  wrapIcon,
} from '@mog/icons';

import type { CSSProperties, ComponentType, SVGProps } from 'react';

// =============================================================================
// Types
// =============================================================================

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

// =============================================================================
// Icon Wrapper Utilities
// =============================================================================

const iconStyle = { width: 'var(--ribbon-icon-size)', height: 'var(--ribbon-icon-size)' };
const iconStyleLarge = { width: 20, height: 20 };
const iconStyleXL = { width: 24, height: 24 };

/** Creates an icon component with specific styling */
function createIcon(Svg: SvgComponent, style: CSSProperties = iconStyle) {
  return function Icon() {
    return <Svg style={style} />;
  };
}

/** Creates an icon component with a dynamic color prop */
function createColorIcon(Svg: SvgComponent, style: CSSProperties = iconStyle) {
  return function ColorIcon({ color }: { color?: string }) {
    return <Svg style={{ ...style, '--icon-color': color } as CSSProperties} />;
  };
}

// =============================================================================
// Undo/Redo Icons
// =============================================================================

export const UndoIcon = wrapIcon(UndoSvg);
export const RedoIcon = wrapIcon(RedoSvg);

// =============================================================================
// Text Formatting Icons
// =============================================================================

export const BoldIcon = wrapIcon(BoldSvg);
export const ItalicIcon = wrapIcon(ItalicSvg);
export const UnderlineIcon = wrapIcon(UnderlineSvg);
export const StrikethroughIcon = wrapIcon(StrikethroughSvg);
export const FontIcon = createIcon(FontSvg);
export const FontSizeIcon = createIcon(FontSizeSvg);
export const FontSizeIncreaseIcon = createIcon(FontSizeIncreaseSvg);
export const FontSizeDecreaseIcon = createIcon(FontSizeDecreaseSvg);

// =============================================================================
// Alignment Icons
// =============================================================================

export const AlignLeftIcon = createIcon(AlignLeftSvg);
export const AlignCenterIcon = createIcon(AlignCenterSvg);
export const AlignRightIcon = createIcon(AlignRightSvg);
export const AlignTopIcon = createIcon(AlignTopSvg);
export const AlignMiddleIcon = createIcon(AlignMiddleSvg);
export const AlignBottomIcon = createIcon(AlignBottomSvg);
export const WordWrapIcon = createIcon(TextWrapSvg);

// =============================================================================
// Border & Cell Icons
// =============================================================================

export const BorderIcon = createIcon(BorderAllSvg);
export const BorderTopIcon = createIcon(BorderTopSvg);
export const BorderBottomIcon = createIcon(BorderBottomSvg);
export const BorderLeftIcon = createIcon(BorderLeftSvg);
export const BorderRightIcon = createIcon(BorderRightSvg);
export const BorderNoneIcon = createIcon(BorderNoneSvg);
export const BorderOutsideIcon = createIcon(BorderOutsideSvg);

// =============================================================================
// File Operation Icons
// =============================================================================

export const DownloadIcon = createIcon(DownloadSvg);
export const SaveIcon = createIcon(SaveSvg);
export const PrintIcon = createIcon(PrintSvg);
export const PdfIcon = createIcon(PdfSvg);

// =============================================================================
// Status Icons
// =============================================================================

export function SpinnerIcon() {
  return <SpinnerSvg style={{ ...iconStyle, animation: 'spin 1s linear infinite' }} />;
}

// =============================================================================
// Feature Icons
// =============================================================================

export const ConditionalFormatIcon = createIcon(ConditionalFormatSvg, iconStyleLarge);
export const DataValidationIcon = createIcon(CheckmarkCircleSvg, iconStyleLarge);
// F1: Circle Invalid Data - using CircleSvg with red dashed appearance
export const CircleInvalidDataIcon = createIcon(CircleSvg, {
  ...iconStyleLarge,
  color: 'var(--color-ss-error)', // Red color to indicate validation errors
});
export const PivotTableIcon = createIcon(PivotTableSvg, iconStyleLarge);
export const TableIcon = createIcon(TableAddSvg, iconStyleLarge);
export const ClearFormatIcon = createIcon(EraserSvg);
export const FormatPainterIcon = createIcon(PaintBrushSvg);

// =============================================================================
// Color Icons (with dynamic color prop)
// =============================================================================

export const FontColorIcon = createColorIcon(FontColorSvg);
export const FillColorIcon = createColorIcon(FillColorSvg);

// =============================================================================
// UI Icons
// =============================================================================

export function DropdownArrowIcon({ className }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center ${className ?? ''}`}>
      <DropdownArrowSvg style={{ width: 10, height: 10 }} />
    </span>
  );
}

export function ChevronDownIcon() {
  return <ChevronDownSvg style={{ width: 10, height: 10 }} />;
}

export function ChevronRightIcon() {
  return <ChevronRightSvg style={{ width: 10, height: 10 }} />;
}

export function ChevronUpIcon() {
  return <ChevronUpSvg style={{ width: 10, height: 10 }} />;
}

// =============================================================================
// Clipboard Icons
// =============================================================================

export const CutIcon = wrapIcon(CutSvg);
export const CopyIcon = wrapIcon(CopySvg);
export const PasteIcon = wrapIcon(PasteSvg);

// =============================================================================
// Tab Icons (for ribbon tab headers)
// =============================================================================

export const DrawIcon = createIcon(PenSvg);
export const PageLayoutIcon = createIcon(MarginsSvg);
export const FormulasIcon = createIcon(FormulaSvg);
export const DataIcon = createIcon(TableEditSvg);
export const ReviewIcon = createIcon(CommentSvg);
export const ViewIcon = createIcon(GridSvg);

// =============================================================================
// Sort & Filter Icons (for Data tab)
// =============================================================================

export const SortAscIcon = createIcon(SortAscendingSvg);
export const SortDescIcon = createIcon(SortDescendingSvg);
export const FilterIcon = createIcon(FilterSvg);
export const TextToColumnsIcon = createIcon(TextToColumnsSvg);
export const RemoveDuplicatesIcon = createIcon(RemoveDuplicatesSvg);
export const ClearFilterIcon = createIcon(ClearFilterSvg);
export const ReapplyFilterIcon = createIcon(ReapplyFilterSvg);
export const AdvancedFilterIcon = createIcon(AdvancedFilterSvg);
export const FlashFillIcon = createIcon(FlashFillSvg);
export const ConsolidateIcon = createIcon(ConsolidateSvg);

// =============================================================================
// Review Tab Icons
// =============================================================================

export const CommentIcon = createIcon(CommentSvg);
export const SpellCheckIcon = createIcon(SpellCheckSvg);
export const ProtectSheetIcon = createIcon(LockSvg);
export const ProtectWorkbookIcon = createIcon(ProtectWorkbookSvg);

// =============================================================================
// View Tab Icons
// =============================================================================

export const GridlinesIcon = createIcon(GridSvg);
export const HeadingsIcon = createIcon(FontSvg);
export const FreezePanesIcon = createIcon(FreezeRowSvg);
export const ZoomInIcon = createIcon(ZoomInSvg);
export const ZoomOutIcon = createIcon(ZoomOutSvg);
export const SettingsIcon = createIcon(SettingsSvg);

// =============================================================================
// Formulas Tab Icons
// =============================================================================

export const FunctionIcon = createIcon(FormulaSvg);
export const AutoSumIcon = createIcon(AutosumSvg);
export const NameManagerIcon = createIcon(NameManagerSvg);
export const TracePrecedentsIcon = createIcon(TracePrecedentsSvg);
export const TraceDependentsIcon = createIcon(TraceDependentsSvg);
export const ShowFormulasIcon = createIcon(FormulaSvg);
export const CalculateIcon = createIcon(SyncSvg);

// =============================================================================
// Page Layout Tab Icons
// =============================================================================

export const MarginsIcon = createIcon(MarginsSvg);
export const OrientationIcon = createIcon(OrientationSvg);
export const PrintAreaIcon = createIcon(PrintSvg);
export const PageBreaksIcon = createIcon(PageBreaksSvg);
export const SizeIcon = createIcon(PageFitSvg);
export const PrintTitlesIcon = createIcon(PrintTitlesSvg);
export const ScaleIcon = createIcon(ZoomInSvg);
export const ScaleWidthIcon = createIcon(ScaleWidthSvg);
export const ScaleHeightIcon = createIcon(ScaleHeightSvg);

// =============================================================================
// Draw Tab Icons
// =============================================================================

export const PenIcon = createIcon(PenSvg);
export const HighlighterIcon = createIcon(HighlighterSvg);
export const EraserIcon = createIcon(EraserSvg);
export const SelectToolIcon = createIcon(SelectObjectSvg);
export const SelectObjectsIcon = createIcon(SelectObjectsSvg);
export const InkToShapeIcon = createIcon(InkToShapeSvg);
export const InkToMathIcon = createIcon(InkToMathSvg);

// =============================================================================
// Number Format Icons
// =============================================================================

export const NumberFormatIcon = createIcon(NumberSvg);
export const PercentIcon = createIcon(PercentSvg);
export const CurrencyIcon = createIcon(CurrencySvg);
export const DecimalIncreaseIcon = createIcon(DecimalIncreaseSvg);
export const DecimalDecreaseIcon = createIcon(DecimalDecreaseSvg);
export const CommaStyleIcon = createIcon(CommaStyleSvg, { ...iconStyle, overflow: 'visible' });

// =============================================================================
// Link Icons
// =============================================================================

export const HyperlinkIcon = createIcon(LinkSvg);

// =============================================================================
// Grouping/Outline Icons
// =============================================================================

export const GroupIcon = createIcon(GroupListSvg);
export const UngroupIcon = createIcon(GroupListSvg); // Same icon, context differentiates
export const ShowDetailIcon = createIcon(AddSvg);
export const HideDetailIcon = createIcon(SubtractSvg);
export const SubtotalIcon = createIcon(AutosumSvg);

// =============================================================================
// Sparkline Icons
// =============================================================================

export const SparklineIcon = createIcon(DataLineSvg, iconStyleLarge);
export const LineSparklineIcon = createIcon(SparklineLineSvg, iconStyleLarge);
export const ColumnSparklineIcon = createIcon(SparklineColumnSvg, iconStyleLarge);
export const WinLossSparklineIcon = createIcon(SparklineWinlossSvg, iconStyleLarge);

// =============================================================================
// Floating Objects Icons
// =============================================================================

export const PictureIcon = createIcon(ImageSvg, iconStyleLarge);
export const ShapesIcon = createIcon(ShapesSvg, iconStyleLarge);
export const TextBoxIcon = createIcon(TextboxSvg, iconStyleLarge);
export const BringToFrontIcon = createIcon(BringToFrontSvg);
export const SendToBackIcon = createIcon(SendToBackSvg);
export const BringForwardIcon = createIcon(BringForwardSvg);
export const SendBackwardIcon = createIcon(SendBackwardSvg);

// =============================================================================
// Shape Icons (for shape gallery)
// =============================================================================

export const RectangleShapeIcon = createIcon(SquareSvg, iconStyleXL);
export const RoundedRectShapeIcon = createIcon(RoundedRectSvg, iconStyleXL);
export const EllipseShapeIcon = createIcon(CircleSvg, iconStyleXL);
export const TriangleShapeIcon = createIcon(TriangleSvg, iconStyleXL);
export const DiamondShapeIcon = createIcon(DiamondSvg, iconStyleXL);
export const ArrowShapeIcon = createIcon(ArrowRightSvg, iconStyleXL);
export const StarShapeIcon = createIcon(StarSvg, iconStyleXL);
export const LineShapeIcon = createIcon(LineSvg, iconStyleXL);

// =============================================================================
// Merge Cell Icons
// =============================================================================

export const MergeCellsIcon = createIcon(CellsMergeSvg);
export const MergeAndCenterIcon = createIcon(MergeCenterSvg);
export const MergeAcrossIcon = createIcon(MergeAcrossSvg);
export const UnmergeCellsIcon = createIcon(CellsSplitSvg);

// =============================================================================
// Data Connections Icons
// =============================================================================

export const ConnectionsIcon = createIcon(ConnectionsSvg);
export const CellBindingIcon = createIcon(LinkSvg);
export const GetDataIcon = createIcon(GetDataSvg, iconStyleLarge);
export const RefreshAllIcon = createIcon(SyncSvg);

// =============================================================================
// Page Layout - Themes Group Icons
// =============================================================================

export const ThemesIcon = createIcon(ThemesSvg);
export const ThemeColorsIcon = createIcon(ThemeColorsSvg);
export const ThemeFontsIcon = createIcon(ThemeFontsSvg);

// =============================================================================
// Home Tab - Cells Group Icons
// =============================================================================

export const InsertCellsIcon = createIcon(TableAddSvg);
export const InsertRowIcon = createIcon(InsertRowSvg);
export const InsertColumnIcon = createIcon(InsertColumnSvg);
export const InsertSheetIcon = createIcon(InsertSheetSvg);
export const DeleteCellsIcon = createIcon(TableDismissSvg);
export const DeleteRowIcon = createIcon(DeleteRowSvg);
export const DeleteColumnIcon = createIcon(DeleteColumnSvg);
export const DeleteSheetIcon = createIcon(DeleteSheetSvg);
export const FormatCellsIcon = createIcon(TableEditSvg);
export const RowHeightIcon = createIcon(RowHeightSvg);
export const ColumnWidthIcon = createIcon(ColumnWidthSvg);
export const HideRowIcon = createIcon(HideRowSvg);
export const HideColumnIcon = createIcon(HideColumnSvg);

// =============================================================================
// Home Tab - Editing Group Icons
// =============================================================================

export const FillDownIcon = createIcon(ArrowDownSvg);
export const FillRightIcon = createIcon(ArrowRightSvg);
export const FillUpIcon = createIcon(ArrowUpSvg);
export const FillLeftIcon = createIcon(ArrowLeftSvg);
export const FillSeriesIcon = createIcon(FillSeriesSvg);
export const ClearAllIcon = createIcon(ClearFormattingSvg);
export const ClearFormatsIcon = createIcon(EraserSvg);
export const ClearContentsIcon = createIcon(ClearContentsSvg);
export const ClearCommentsIcon = createIcon(ClearCommentsSvg);
export const FindAndReplaceIcon = createIcon(SearchSvg);
export const GoToIcon = createIcon(GoToSvg);
export const SelectAllIcon = createIcon(SelectAllSvg);

// =============================================================================
// Insert Tab - Illustrations Icons
// =============================================================================

export const IconsIcon = createIcon(IconsSvg, iconStyleLarge);
export const Model3DIcon = createIcon(Model3DSvg, iconStyleLarge);
export const DiagramIcon = createIcon(DiagramSvg, iconStyleLarge);
export const ScreenshotIcon = createIcon(ScreenshotSvg, iconStyleLarge);

// =============================================================================
// Insert Tab - Text Group Icons
// =============================================================================

export const HeaderFooterIcon = createIcon(HeaderFooterSvg, iconStyleLarge);
export const TextEffectIcon = createIcon(TextEffectSvg, iconStyleLarge);
export const ObjectIcon = createIcon(ObjectSvg, iconStyleLarge);
export const EquationIcon = createIcon(EquationSvg, iconStyleLarge);
export const NewCommentIcon = createIcon(NewCommentSvg, iconStyleLarge);

// =============================================================================
// Insert Tab - Filters & Charts Icons
// =============================================================================

export const SlicerIcon = createIcon(SlicerSvg, iconStyleLarge);
export const TimelineIcon = createIcon(TimelineSvg, iconStyleLarge);
export const RecommendedChartsIcon = createIcon(RecommendedChartsSvg, iconStyleLarge);
export const PivotChartIcon = createIcon(PivotChartSvg, iconStyleLarge);
export const FormsIcon = createIcon(FormsSvg, iconStyleLarge);

// =============================================================================
// Text Orientation Icons
// =============================================================================

export const TextOrientationIcon = createIcon(TextOrientationSvg);
export const AngleCounterclockwiseIcon = createIcon(AngleCounterclockwiseSvg);
export const AngleClockwiseIcon = createIcon(AngleClockwiseSvg);
export const VerticalTextIcon = createIcon(VerticalTextSvg);
export const RotateTextUpIcon = createIcon(RotateTextUpSvg);
export const RotateTextDownIcon = createIcon(RotateTextDownSvg);
export const IncreaseIndentIcon = createIcon(IncreaseIndentSvg);
export const DecreaseIndentIcon = createIcon(DecreaseIndentSvg);

// =============================================================================
// Paste Options Icons
// =============================================================================

export const PasteValuesIcon = createIcon(PasteValuesSvg);
export const PasteFormulasIcon = createIcon(PasteFormulasSvg);
export const PasteFormattingIcon = createIcon(PasteFormattingSvg);
export const PasteSpecialIcon = createIcon(PasteSpecialSvg);

// =============================================================================
// Border Icons (Extended)
// =============================================================================

export const BorderHorizontalIcon = createIcon(BorderHorizontalSvg);
export const BorderVerticalIcon = createIcon(BorderVerticalSvg);
export const BorderThickOutsideIcon = createIcon(BorderThickOutsideSvg);

// =============================================================================
// View Ribbon Icons
// =============================================================================

export const FormulaBarIcon = createIcon(FormulaBarSvg);
export const CheckIcon = createIcon(CheckSvg);
export const SplitViewIcon = createIcon(SplitViewSvg);
export const PageLayoutViewIcon = createIcon(PageLayoutViewSvg);
export const CustomViewsIcon = createIcon(CustomViewsSvg);
export const RulerIcon = createIcon(RulerSvg);
export const NewWindowIcon = createIcon(NewWindowSvg);
export const ArrangeAllIcon = createIcon(ArrangeAllSvg);
export const HideIcon = createIcon(HideSvg);
export const UnhideIcon = createIcon(UnhideSvg);
export const SwitchWindowsIcon = createIcon(SwitchWindowsSvg);
export const MacrosIcon = createIcon(MacrosSvg);
export const RecordMacroIcon = createIcon(RecordMacroSvg);
export const RelativeReferencesIcon = createIcon(RelativeReferencesSvg);

// =============================================================================
// Review Ribbon Icons
// =============================================================================

export const DeleteCommentIcon = createIcon(DeleteCommentSvg);
export const PreviousCommentIcon = createIcon(PreviousCommentSvg);
export const NextCommentIcon = createIcon(NextCommentSvg);
export const NoteIcon = createIcon(NoteSvg);
export const ThesaurusIcon = createIcon(ThesaurusSvg);
export const ShowHideCommentIcon = createIcon(ShowHideCommentSvg);
export const ShowAllCommentsIcon = createIcon(ShowAllCommentsSvg);
export const WorkbookStatisticsIcon = createIcon(WorkbookStatisticsSvg);
export const AccessibilityIcon = createIcon(AccessibilitySvg);
export const ReadOnlyIcon = createIcon(ReadOnlySvg);

// =============================================================================
// Table Design Icons
// =============================================================================

export const ConvertToRangeIcon = createIcon(ConvertToRangeSvg);
export const DeleteTableIcon = createIcon(DeleteSvg);
export const DeleteIcon = createIcon(DeleteSvg);

// =============================================================================
// Dialog Icons
// =============================================================================

export const CloseIcon = createIcon(CloseSvg);

// =============================================================================
// Test Panel Icons
// =============================================================================

export const PlayIcon = createIcon(PlaySvg);

// =============================================================================
// Chart Type Icons (for chart galleries and toolbars)
// =============================================================================

export const ChartIcon = createIcon(ChartSvg, iconStyleLarge);
export const ChartColumnIcon = createIcon(ChartColumnSvg, iconStyleLarge);
export const ChartBarIcon = createIcon(ChartBarSvg, iconStyleLarge);
export const ChartLineIcon = createIcon(ChartLineSvg, iconStyleLarge);
export const ForecastSheetIcon = createIcon(ChartLineSvg, iconStyleLarge);
export const ChartAreaIcon = createIcon(ChartAreaSvg, iconStyleLarge);
export const ChartPieIcon = createIcon(ChartPieSvg, iconStyleLarge);
export const ChartDoughnutIcon = createIcon(ChartDoughnutSvg, iconStyleLarge);
export const ChartScatterIcon = createIcon(ChartScatterSvg, iconStyleLarge);
export const ChartBubbleIcon = createIcon(ChartBubbleSvg, iconStyleLarge);
export const ChartComboIcon = createIcon(ChartComboSvg, iconStyleLarge);
export const ChartRadarIcon = createIcon(ChartRadarSvg, iconStyleLarge);
export const ChartStockIcon = createIcon(ChartStockSvg, iconStyleLarge);
export const ChartFunnelIcon = createIcon(ChartFunnelSvg, iconStyleLarge);
export const ChartWaterfallIcon = createIcon(ChartWaterfallSvg, iconStyleLarge);
