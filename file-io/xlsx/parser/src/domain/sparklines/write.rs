//! Sparklines Writer for XLSX worksheets.
//!
//! This module generates sparkline XML elements for worksheet files according to
//! the ECMA-376 `x14:sparklineGroups` extension used by Excel 2010 and later.
//! The historical module path remains a compatibility facade while private child
//! modules own the builder, OOXML writer, domain bridge, and formatting helpers.

mod builder;
mod constants;
mod domain_bridge;
mod format;
mod ooxml;
mod writer;

// Re-export canonical types from ooxml_types.
pub use ooxml_types::sparklines::{
    DisplayEmptyCellsAs, Sparkline, SparklineAxisType, SparklineColor, SparklineGroup,
    SparklineType,
};

pub use self::builder::SparklineGroupBuilder;
pub use self::domain_bridge::{sparkline_groups_xml_from_domain, sparklines_xml_from_domain};
pub use self::writer::SparklinesWriter;

pub(crate) use self::format::hex_to_argb;

#[cfg(test)]
mod tests;
