//! Controls domain — form controls, ActiveX objects, OLE objects, and VML.

pub mod active_x;
pub mod anchors;
pub mod form_control_props;
pub mod mapping;
pub mod ole;
pub mod read;
pub mod relationships;
pub mod types;
pub mod vml;
mod vml_write;
pub mod worksheet;
pub mod write;
pub mod write_ole;

#[cfg(test)]
mod tests;
