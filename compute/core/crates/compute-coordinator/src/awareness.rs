use std::collections::HashMap;

use crate::types::ParticipantId;

/// Per-room awareness state. Stores opaque JSON presence blobs per participant.
///
/// LWW (last-writer-wins) per client: each participant's state is simply
/// overwritten on set. The TS layer defines the schema (displayName, color,
/// selection, editing); Rust stores and relays without parsing.
#[derive(Debug, Clone)]
pub struct AwarenessState {
    /// participantId → JSON state string
    states: HashMap<ParticipantId, String>,
    /// Monotonic clock for encoding updates. Incremented on each mutation.
    clock: u64,
}

/// Error applying an awareness update.
#[derive(Debug, thiserror::Error)]
pub enum AwarenessError {
    #[error("invalid awareness update: {0}")]
    InvalidUpdate(String),
}

/// A serialized awareness update for wire transport.
/// Format: JSON object mapping participantId → state JSON string (or null for removal).
#[derive(Debug, Clone)]
pub struct AwarenessUpdate {
    /// Map of participantId → Some(stateJson) for set, None for remove.
    pub changes: HashMap<ParticipantId, Option<String>>,
}

impl AwarenessState {
    pub fn new() -> Self {
        Self {
            states: HashMap::new(),
            clock: 0,
        }
    }

    /// Set state for a participant. Returns an encoded update to broadcast.
    pub fn set_state(&mut self, participant_id: &str, state_json: &str) -> Vec<u8> {
        self.states
            .insert(participant_id.to_string(), state_json.to_string());
        self.clock += 1;

        // Encode a single-entry update
        let mut changes = HashMap::new();
        changes.insert(participant_id.to_string(), Some(state_json.to_string()));
        encode_update(&AwarenessUpdate { changes })
    }

    /// Remove state for a participant (they left). Returns an encoded update to broadcast.
    pub fn remove_state(&mut self, participant_id: &str) -> Vec<u8> {
        self.states.remove(participant_id);
        self.clock += 1;

        let mut changes = HashMap::new();
        changes.insert(participant_id.to_string(), None);
        encode_update(&AwarenessUpdate { changes })
    }

    /// Get all current states as a JSON string: `{ "participantId": "stateJson", ... }`.
    pub fn get_states_json(&self) -> String {
        let map: serde_json::Map<String, serde_json::Value> = self
            .states
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        serde_json::Value::Object(map).to_string()
    }

    /// Apply an encoded awareness update from a remote peer.
    /// Returns the bytes to broadcast to other peers.
    pub fn apply_update(&mut self, update: &[u8]) -> Result<Vec<u8>, AwarenessError> {
        let decoded = decode_update(update)?;

        for (pid, state) in &decoded.changes {
            match state {
                Some(json) => {
                    self.states.insert(pid.clone(), json.clone());
                }
                None => {
                    self.states.remove(pid);
                }
            }
        }
        self.clock += 1;

        // Re-encode and return for broadcast
        Ok(encode_update(&decoded))
    }

    /// Encode current full awareness state as bytes (for a joining peer).
    pub fn encode_full_state(&self) -> Vec<u8> {
        let changes: HashMap<ParticipantId, Option<String>> = self
            .states
            .iter()
            .map(|(k, v)| (k.clone(), Some(v.clone())))
            .collect();
        encode_update(&AwarenessUpdate { changes })
    }

    /// Number of participants with awareness state.
    pub fn participant_count(&self) -> usize {
        self.states.len()
    }
}

impl Default for AwarenessState {
    fn default() -> Self {
        Self::new()
    }
}

/// Encode an awareness update to bytes.
/// Wire format: JSON `{ "changes": { "pid": "stateJson" | null, ... } }`
fn encode_update(update: &AwarenessUpdate) -> Vec<u8> {
    let map: serde_json::Map<String, serde_json::Value> = update
        .changes
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                match v {
                    Some(json) => serde_json::Value::String(json.clone()),
                    None => serde_json::Value::Null,
                },
            )
        })
        .collect();
    let obj = serde_json::json!({ "changes": map });
    serde_json::to_vec(&obj).expect("awareness update serialization cannot fail")
}

/// Decode bytes into an awareness update.
fn decode_update(data: &[u8]) -> Result<AwarenessUpdate, AwarenessError> {
    let val: serde_json::Value = serde_json::from_slice(data)
        .map_err(|e| AwarenessError::InvalidUpdate(format!("invalid JSON: {e}")))?;

    let changes_val = val
        .get("changes")
        .ok_or_else(|| AwarenessError::InvalidUpdate("missing 'changes' field".into()))?;

    let obj = changes_val
        .as_object()
        .ok_or_else(|| AwarenessError::InvalidUpdate("'changes' is not an object".into()))?;

    let mut changes = HashMap::new();
    for (k, v) in obj {
        let state = if v.is_null() {
            None
        } else {
            Some(
                v.as_str()
                    .ok_or_else(|| {
                        AwarenessError::InvalidUpdate(format!("state for '{k}' is not a string"))
                    })?
                    .to_string(),
            )
        };
        changes.insert(k.clone(), state);
    }

    Ok(AwarenessUpdate { changes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_states() {
        let mut awareness = AwarenessState::new();
        awareness.set_state("user-1", r##"{"name":"Alice","color":"#ff0000"}"##);
        awareness.set_state("user-2", r##"{"name":"Bob","color":"#00ff00"}"##);

        let json = awareness.get_states_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            parsed["user-1"].as_str().unwrap(),
            r##"{"name":"Alice","color":"#ff0000"}"##
        );
        assert_eq!(
            parsed["user-2"].as_str().unwrap(),
            r##"{"name":"Bob","color":"#00ff00"}"##
        );
    }

    #[test]
    fn remove_state() {
        let mut awareness = AwarenessState::new();
        awareness.set_state("user-1", r#"{"name":"Alice"}"#);
        assert_eq!(awareness.participant_count(), 1);

        awareness.remove_state("user-1");
        assert_eq!(awareness.participant_count(), 0);

        let json = awareness.get_states_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.as_object().unwrap().is_empty());
    }

    #[test]
    fn apply_update_set() {
        let mut a1 = AwarenessState::new();
        let mut a2 = AwarenessState::new();

        // a1 sets state
        let update = a1.set_state("user-1", r#"{"name":"Alice"}"#);

        // a2 applies the update
        let _broadcast = a2.apply_update(&update).unwrap();

        let json = a2.get_states_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["user-1"].as_str().unwrap(), r#"{"name":"Alice"}"#);
    }

    #[test]
    fn apply_update_remove() {
        let mut a1 = AwarenessState::new();
        let mut a2 = AwarenessState::new();

        // Setup: both have user-1
        let update = a1.set_state("user-1", r#"{"name":"Alice"}"#);
        a2.apply_update(&update).unwrap();

        // a1 removes user-1
        let remove_update = a1.remove_state("user-1");
        a2.apply_update(&remove_update).unwrap();

        assert_eq!(a2.participant_count(), 0);
    }

    #[test]
    fn full_state_roundtrip() {
        let mut a1 = AwarenessState::new();
        a1.set_state("user-1", r#"{"name":"Alice"}"#);
        a1.set_state("user-2", r#"{"name":"Bob"}"#);

        let full = a1.encode_full_state();

        let mut a2 = AwarenessState::new();
        a2.apply_update(&full).unwrap();

        assert_eq!(a2.participant_count(), 2);
        let json = a2.get_states_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed["user-1"].as_str().is_some());
        assert!(parsed["user-2"].as_str().is_some());
    }

    #[test]
    fn lww_last_write_wins() {
        let mut awareness = AwarenessState::new();
        awareness.set_state("user-1", r#"{"sel":"A1"}"#);
        awareness.set_state("user-1", r#"{"sel":"B2"}"#);

        let json = awareness.get_states_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["user-1"].as_str().unwrap(), r#"{"sel":"B2"}"#);
    }
}
