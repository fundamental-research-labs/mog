//! Color types for DrawingML (ECMA-376 EG_ColorChoice).

mod choice;
mod preset;
mod scheme;
mod system;
mod transform;

pub use choice::DrawingColor;
pub use preset::PresetColorVal;
pub use scheme::SchemeColor;
pub use system::SystemColorVal;
pub use transform::ColorTransform;
