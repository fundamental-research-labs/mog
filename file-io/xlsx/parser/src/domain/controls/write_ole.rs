//! Compatibility facade for OLE worksheet writer APIs.
//!
//! The implementation lives in `controls::ole`; this module keeps historical
//! `controls::write_ole` imports stable during the controls-domain refactor.

pub use super::ole::{OleWriter, ole_object_relationship_target, ole_object_zip_path};
