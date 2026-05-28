//! Structured in-cell image values.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// Supported sizing modes for the spreadsheet `IMAGE` function.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CellImageSizing {
    /// Fit the image within the cell while preserving aspect ratio.
    Fit,
    /// Fill the cell while preserving aspect ratio, clipping overflow.
    Fill,
    /// Use the image's intrinsic size.
    Original,
    /// Use caller-provided height and width.
    Custom,
}

/// First-class computed image result for in-cell rendering.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellImage {
    /// Image source URL.
    pub source: Arc<str>,
    /// Optional accessible fallback text.
    pub alt_text: Option<Arc<str>>,
    /// Sizing behavior requested by the formula.
    pub sizing: CellImageSizing,
    /// Optional custom height in CSS pixels.
    pub height: Option<u32>,
    /// Optional custom width in CSS pixels.
    pub width: Option<u32>,
}

impl CellImage {
    /// Create a structured image value.
    #[must_use]
    pub fn new(
        source: impl Into<Arc<str>>,
        alt_text: Option<Arc<str>>,
        sizing: CellImageSizing,
        height: Option<u32>,
        width: Option<u32>,
    ) -> Self {
        Self {
            source: source.into(),
            alt_text,
            sizing,
            height,
            width,
        }
    }

    /// User-visible fallback text for accessibility, copy, and failed image loads.
    #[must_use]
    pub fn fallback_text(&self) -> &str {
        self.alt_text.as_deref().unwrap_or(self.source.as_ref())
    }
}
