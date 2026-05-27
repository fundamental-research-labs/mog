//! Object-domain engine service facade.
//!
//! Bridge-facing methods delegate through this module. Child modules keep the
//! service functions grouped by object domain while this module preserves the
//! existing `services::objects::*` call surface.

mod charts;
mod comments;
mod floating;
mod groups;
mod hyperlinks;
mod pivots;
mod shared;
mod z_order;

pub(in crate::storage::engine) use charts::*;
pub(in crate::storage::engine) use comments::*;
pub(in crate::storage::engine) use floating::*;
pub(in crate::storage::engine) use groups::*;
pub(in crate::storage::engine) use hyperlinks::*;
pub(in crate::storage::engine) use pivots::*;
pub(in crate::storage::engine) use z_order::*;
