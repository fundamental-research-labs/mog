//! Conversion from read-side drawing types to write-side drawing types.
//!
//! This module is the public conversion boundary for parsed drawings. Concrete
//! object conversion lives in sibling modules; callers should route parsed
//! drawing content through this boundary rather than through writer internals.

use super::write;
use crate::domain::drawings as read;

mod anchors;
mod objects;
mod outcome;

pub use anchors::{convert_absolute_anchor, convert_one_cell_anchor, convert_two_cell_anchor};
pub use objects::{
    connector_to_props, convert_drawing_content, convert_drawing_content_with_outcome,
    extract_chart_ref_from_graphic_frame, group_shape_to_props, picture_to_image_props,
    populate_smartart_parts, shape_to_text_box,
};
pub use outcome::{ConversionStatus, DrawingConversionOutcome};
