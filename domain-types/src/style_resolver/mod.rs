//! Standalone style resolver: OOXML multi-level style tables -> flat `DocumentFormat` palette.
//!
//! Takes generic inputs (simple structs defined here), not xlsx-parser types, and
//! produces `Vec<DocumentFormat>` from the public format model.

mod cache;
mod color;
mod components;
mod input;
mod number_format;
mod xf;

#[cfg(test)]
mod tests;

pub use cache::FormatCache;
pub use input::{
    AlignmentInput, BorderInput, BorderSideInput, CellXfInput, ColorInput, FillInput, FontInput,
    GradientFillInput, GradientStopInput, ProtectionInput, StyleInput,
};

use crate::DocumentFormat;

/// Resolve all cell XF records into a flat `Vec<DocumentFormat>`.
///
/// The returned vec is indexed by style index (same position as `cell_xfs`).
/// Style index 0 resolves the Normal base style from `cell_style_xfs[0]` when present.
///
/// This is the main entry point for style resolution.
pub fn resolve_styles(input: &StyleInput) -> Vec<DocumentFormat> {
    let mut result = Vec::with_capacity(input.cell_xfs.len());

    for (idx, xf) in input.cell_xfs.iter().enumerate() {
        if idx == 0 {
            let base = input
                .cell_style_xfs
                .first()
                .map(|base_xf| xf::resolve_xf_direct(base_xf, input))
                .unwrap_or_default();
            result.push(base);
            continue;
        }

        match xf::resolve_single_xf(xf, input) {
            Some(fmt) => result.push(fmt),
            None => result.push(DocumentFormat::default()),
        }
    }

    result
}

/// Resolve a single style index, using a `FormatCache` for memoization.
///
/// Returns `None` for the default style (index 0) or unknown indices.
pub fn resolve_style(
    style_idx: u32,
    input: &StyleInput,
    cache: &mut FormatCache,
) -> Option<DocumentFormat> {
    if style_idx == 0 {
        return None;
    }
    cache.get(style_idx, input).cloned()
}
