//! Conversion from read-side drawing types to write-side drawing types.
//!
//! This module is the public conversion boundary for parsed drawings. Concrete
//! object conversion lives in sibling modules; callers should route parsed
//! drawing content through this boundary rather than through writer internals.

use super::write;
use crate::domain::drawings as read;

mod anchors;
mod connectors;
mod dispatch;
mod graphic_frames;
mod groups;
mod outcome;
mod pictures;
mod shapes;
mod smartart;

#[cfg(test)]
mod tests;

pub use anchors::{convert_absolute_anchor, convert_one_cell_anchor, convert_two_cell_anchor};
pub use connectors::connector_to_props;
pub use dispatch::{convert_drawing_content, convert_drawing_content_with_outcome};
pub use graphic_frames::extract_chart_ref_from_graphic_frame;
pub use groups::group_shape_to_props;
pub use outcome::{ConversionStatus, DrawingConversionOutcome};
pub use pictures::picture_to_image_props;
pub use shapes::shape_to_text_box;
pub use smartart::populate_smartart_parts;
