//! Multi-participant sync coordinator with sheet-level locking.
//!
//! `SyncCoordinator` is a pure Rust struct — no async, no network, no tokio.
//! It manages the authoritative Yrs document, participant lifecycle, and
//! sheet-level locks. Transports (HTTP, WebSocket, in-process) wrap it.

pub mod awareness;
mod coordinator;
mod lock_table;
mod participant;
mod time_budget;
mod types;

pub use awareness::{AwarenessError, AwarenessState};
pub use coordinator::SyncCoordinator;
pub use types::*;

#[cfg(test)]
mod tests;
