//! # Yrs Sync Protocol
//!
//! Compatibility facade for the v1 Yrs/Yjs sync protocol used by Mog.
//! The crate root intentionally exposes the stable public API while the
//! implementation is split into focused private modules:
//!
//! - `protocol`: state vectors, diffs, full-state encoding, and update apply.
//! - `observe`: post-commit v1 update subscriptions.
//! - `undo`: undo capture boundary helper.
//! - `error` and `limits`: public errors and private input guards.
//!
//! All wire encoding uses lib0 v1 format, compatible between yrs and Yjs.

mod error;
mod limits;
mod observe;
mod protocol;
mod undo;

pub use error::SyncError;
pub use observe::{UpdateSubscriptionHandle, subscribe_update_v1};
pub use protocol::{
    apply_update, decode_state_vector, encode_diff, encode_full_state, encode_state_vector,
};
pub use undo::flush_undo_capture;
