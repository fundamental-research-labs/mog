//! Chart-specific OOXML mirror domain types.
//!
//! Typed domain wrappers for `ooxml_types` chart fields that need a stable
//! storage/API shape while the broader chart model is elevated. These mirrors
//! preserve serde/Yrs payloads and convert bidirectionally with the OOXML
//! structs they represent.
//!
//! Types with deeply nested OOXML sub-parts that overlap the broader
//! drawings/text-body model keep the outer chart contract typed and carry the
//! deeper content opaquely until those primitives are elevated.

mod chart_type_config;
mod color_mapping;
mod pivot_format;
mod print_settings;
mod protection;
mod sources;
mod waterfall;

pub use chart_type_config::{ChartTypeConfig, OoxmlChartTypeKind};
pub use color_mapping::{ChartColorMapping, ChartColorMappingOverride, ColorSchemeSlot};
pub use pivot_format::ChartPivotFormat;
pub use print_settings::{
    ChartHeaderFooter, ChartPageMargins, ChartPageSetup, ChartPrintSettings, PageOrientation,
};
pub use protection::ChartProtection;
pub use sources::ChartPivotSource;
pub use waterfall::WaterfallOptions;

#[cfg(test)]
mod tests;
