//! Split-view mutation service. Other delegations use the engine directly.

#[cfg(test)]
mod tests;
mod view_state;

pub(in crate::storage::engine) use view_state::set_split_config;
