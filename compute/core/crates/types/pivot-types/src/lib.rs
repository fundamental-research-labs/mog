//! Pivot table types — mirrors TypeScript contracts from `contracts/src/data/pivot.ts`.
//!
//! # Design Philosophy: Parse, Don't Validate
//!
//! These types make invalid pivot configurations **unrepresentable** at the type level.
//! See individual submodules for details.
//!
//! # Serde Compatibility
//!
//! The TypeScript frontend sends flat JSON objects. The flat types in `placement_flat`
//! and `filter_types` provide serde-compatible representations that can be converted
//! to/from the type-safe enums via `From` implementations.

mod config;
mod error;
mod expansion;
mod field;
mod field_id;
mod filter_types;
mod item;
mod placement;
mod placement_flat;
mod result;
mod show_values_as;

pub use config::*;
pub use error::*;
pub use expansion::*;
pub use field::*;
pub use field_id::*;
pub use filter_types::*;
pub use item::*;
pub use placement::*;
pub use placement_flat::*;
pub use result::*;
pub use show_values_as::*;
