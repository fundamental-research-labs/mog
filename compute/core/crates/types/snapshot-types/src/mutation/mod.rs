//! Domain change types and [`MutationResult`] for spreadsheet mutations.
//!
//! Each `*Change` struct represents a single domain-level change that occurred
//! during a mutation command (e.g. formatting, dimension resize, merge, etc.).
//! [`MutationResult`] bundles the recalculation result with all domain changes.

mod cell_grid;
mod features;
mod floating_objects;
mod policy_parse;
mod primitives;
mod result;
mod sheet_workbook;

pub use cell_grid::{
    CommentChange, DimensionChange, MergeChange, PropertyChange, SparklineChange, VisibilityChange,
};
pub use features::{
    CfChange, FilterChange, GroupingChange, NamedRangeChange, PivotTableChange, RangeChange,
    RangeChangeKind, SlicerChange, SlicerChangeKind, SlicerSourceType, SortingChange,
    StructureChangeResult, StructureChangeType, TableChange,
};
pub use floating_objects::{FloatingObjectBounds, FloatingObjectChange};
pub use policy_parse::{
    AutomaticConversionCategory, PolicyPreservedParseOutcome, PolicyPreservedParseSummary,
};
pub use primitives::{
    Axis, ChangeKind, FloatingObjectChangeKind, SheetLifecycleRuntimeHint, UndoState,
};
pub use result::MutationResult;
pub use sheet_workbook::{
    PageBreakChange, PrintAreaChange, PrintSettingsChange, PrintTitlesChange, ScrollPositionChange,
    SheetChange, SheetChangeField, SheetSettingsChange, SplitConfigChange, WorkbookSettingsChange,
};
