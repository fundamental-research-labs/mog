//! Color types for DrawingML (ECMA-376 EG_ColorChoice).

mod scheme;
mod transform;
mod system;
mod preset;
mod choice;

pub use scheme::SchemeColor;
pub use transform::ColorTransform;
pub use system::SystemColorVal;
pub use preset::PresetColorVal;
pub use choice::DrawingColor;
