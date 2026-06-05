//! N-API bindings for SyncCoordinator and engine-from-yrs-state.
//!
//! Uses a global handle table (Vec<Mutex<SyncCoordinator>>) to manage
//! coordinator instances. Each handle is an index into the table.

use cell_types::SheetId;
use compute_coordinator::{LockScope, PushError, SyncCoordinator};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Mutex;
use std::time::Duration;
use yrs::Transact;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn lock_scope_to_json(scope: &LockScope) -> serde_json::Value {
    match scope {
        LockScope::Sheet { sheet_id } => {
            serde_json::json!({"type": "sheet", "sheetId": sheet_id.to_uuid_string()})
        }
        LockScope::Workbook => serde_json::json!({"type": "workbook"}),
        LockScope::Structural { sheet_id } => {
            serde_json::json!({"type": "structural", "sheetId": sheet_id.to_uuid_string()})
        }
    }
}

// ---------------------------------------------------------------------------
// Engine from Yrs state
// ---------------------------------------------------------------------------

/// Convert raw Yrs state bytes into a WorkbookSnapshot JSON string.
///
/// This enables creating a NAPI ComputeEngine that shares the same CellIds
/// and Yrs document origin as the source engine. The TS caller creates the
/// engine with: `new ComputeEngine(snapshotJson)`.
#[napi(js_name = "yrs_state_to_snapshot_json")]
pub fn yrs_state_to_snapshot_json(state: Buffer) -> Result<String> {
    let storage = compute_core::storage::YrsStorage::from_yrs_state(&state)
        .map_err(|e| Error::from_reason(format!("from_yrs_state: {e}")))?;
    {
        let txn = storage.doc().transact();
        compute_document::schema::guard_schema_version(&txn, storage.workbook_map())
            .map_err(|e| Error::from_reason(format!("schema version: {e}")))?;
    }
    compute_core::storage::workbook::imported_pivots::normalize_imported_pivot_associations(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
    )
    .map_err(|e| Error::from_reason(format!("normalize imported pivots: {e}")))?;
    let snapshot =
        compute_core::storage::engine::construction::build_workbook_snapshot_from_yrs(&storage)
            .map_err(|e| Error::from_reason(format!("build snapshot: {e}")))?;
    serde_json::to_string(&snapshot).map_err(|e| Error::from_reason(format!("serialize: {e}")))
}

// ---------------------------------------------------------------------------
// Handle table
// ---------------------------------------------------------------------------

static COORDINATORS: std::sync::LazyLock<Mutex<Vec<Option<Mutex<SyncCoordinator>>>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));

fn with_coordinator<T>(handle: u32, f: impl FnOnce(&mut SyncCoordinator) -> T) -> Result<T> {
    let table = COORDINATORS
        .lock()
        .map_err(|e| Error::from_reason(format!("lock poisoned: {e}")))?;
    let slot = table
        .get(handle as usize)
        .ok_or_else(|| Error::from_reason(format!("invalid coordinator handle: {handle}")))?
        .as_ref()
        .ok_or_else(|| Error::from_reason(format!("coordinator {handle} already disposed")))?;
    let mut coord = slot
        .lock()
        .map_err(|e| Error::from_reason(format!("coordinator lock poisoned: {e}")))?;
    Ok(f(&mut coord))
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[napi(js_name = "coordinator_create")]
pub fn coordinator_create() -> Result<u32> {
    let coord = SyncCoordinator::new();
    insert_coordinator(coord)
}

#[napi(js_name = "coordinator_create_empty")]
pub fn coordinator_create_empty() -> Result<u32> {
    let coord = SyncCoordinator::empty();
    insert_coordinator(coord)
}

fn insert_coordinator(coord: SyncCoordinator) -> Result<u32> {
    let mut table = COORDINATORS
        .lock()
        .map_err(|e| Error::from_reason(format!("{e}")))?;
    // Find an empty slot or push new
    for (i, slot) in table.iter_mut().enumerate() {
        if slot.is_none() {
            *slot = Some(Mutex::new(coord));
            return Ok(i as u32);
        }
    }
    let handle = table.len() as u32;
    table.push(Some(Mutex::new(coord)));
    Ok(handle)
}

#[napi(js_name = "coordinator_create_from_state")]
pub fn coordinator_create_from_state(state: Buffer) -> Result<u32> {
    let coord =
        SyncCoordinator::from_state(&state).map_err(|e| Error::from_reason(format!("{e}")))?;
    let mut table = COORDINATORS
        .lock()
        .map_err(|e| Error::from_reason(format!("{e}")))?;
    let handle = table.len() as u32;
    table.push(Some(Mutex::new(coord)));
    Ok(handle)
}

#[napi(js_name = "coordinator_dispose")]
pub fn coordinator_dispose(handle: u32) -> Result<()> {
    let mut table = COORDINATORS
        .lock()
        .map_err(|e| Error::from_reason(format!("{e}")))?;
    if let Some(slot) = table.get_mut(handle as usize) {
        *slot = None;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Participant lifecycle
// ---------------------------------------------------------------------------

#[napi(js_name = "coordinator_join")]
pub fn coordinator_join(handle: u32, participant_id: String) -> Result<String> {
    with_coordinator(handle, |coord| {
        let result = coord.join(participant_id);
        let val = serde_json::json!({
            "fullState": result.full_state,
            "activeLocks": result.active_locks.iter().map(|l| serde_json::json!({
                "id": l.id.to_string(),
                "owner": l.owner,
                "scope": lock_scope_to_json(&l.scope),
            })).collect::<Vec<_>>(),
            "participantCount": result.participant_count,
        });
        serde_json::to_string(&val).unwrap()
    })
}

#[napi(js_name = "coordinator_leave")]
pub fn coordinator_leave(handle: u32, participant_id: String) -> Result<()> {
    with_coordinator(handle, |coord| {
        coord.leave(&participant_id);
    })
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

#[napi(js_name = "coordinator_push")]
pub fn coordinator_push(
    handle: u32,
    participant_id: String,
    update: Buffer,
    touched_sheet_ids: Vec<String>,
    participant_sv: Buffer,
) -> Result<String> {
    with_coordinator(handle, |coord| {
        let sheets: Vec<SheetId> = touched_sheet_ids
            .iter()
            .filter_map(|s| SheetId::from_uuid_str(s).ok())
            .collect();

        match coord.push(&participant_id, &update, &sheets, &participant_sv) {
            Ok(result) => Ok(serde_json::to_string(&serde_json::json!({
                "ok": true,
                "serverDiff": result.server_diff,
            })).unwrap()),
            Err(PushError::LockViolation(v)) => Ok(serde_json::to_string(&serde_json::json!({
                "ok": false,
                "error": "lock_violation",
                "conflictingLocks": v.conflicting_locks.iter().map(|l| serde_json::json!({
                    "id": l.id.to_string(),
                    "owner": l.owner,
                })).collect::<Vec<_>>(),
                "attemptedSheets": v.attempted_sheets.iter().map(|s| s.to_uuid_string()).collect::<Vec<String>>(),
            })).unwrap()),
            Err(PushError::UnknownParticipant) => Err(Error::from_reason("unknown participant")),
            Err(PushError::SyncError(e)) => Err(Error::from_reason(format!("sync error: {e}"))),
        }
    })?
}

#[napi(js_name = "coordinator_pull")]
pub fn coordinator_pull(
    handle: u32,
    participant_id: String,
    participant_sv: Buffer,
) -> Result<Buffer> {
    with_coordinator(handle, |coord| {
        coord
            .pull(&participant_id, &participant_sv)
            .map(Buffer::from)
            .map_err(|e| Error::from_reason(format!("{e}")))
    })?
}

#[napi(js_name = "coordinator_state_vector")]
pub fn coordinator_state_vector(handle: u32) -> Result<Buffer> {
    with_coordinator(handle, |coord| Buffer::from(coord.state_vector()))
}

#[napi(js_name = "coordinator_full_state")]
pub fn coordinator_full_state(handle: u32) -> Result<Buffer> {
    with_coordinator(handle, |coord| Buffer::from(coord.full_state()))
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

#[napi(js_name = "coordinator_acquire_lock")]
pub fn coordinator_acquire_lock(
    handle: u32,
    owner: String,
    scope_json: String,
    ttl_ms: u32,
) -> Result<String> {
    with_coordinator(handle, |coord| {
        let scope_val: serde_json::Value = serde_json::from_str(&scope_json)
            .map_err(|e| Error::from_reason(format!("invalid scope JSON: {e}")))?;

        let scope = match scope_val.get("type").and_then(|t| t.as_str()) {
            Some("sheet") => {
                let sheet_id_str = scope_val
                    .get("sheetId")
                    .and_then(|s| s.as_str())
                    .ok_or_else(|| Error::from_reason("missing sheetId in scope"))?;
                let sheet_id = SheetId::from_uuid_str(sheet_id_str)
                    .map_err(|e| Error::from_reason(format!("invalid sheetId: {e}")))?;
                LockScope::Sheet { sheet_id }
            }
            Some("workbook") => LockScope::Workbook,
            Some("structural") => {
                let sheet_id_str = scope_val
                    .get("sheetId")
                    .and_then(|s| s.as_str())
                    .ok_or_else(|| Error::from_reason("missing sheetId in structural scope"))?;
                let sheet_id = SheetId::from_uuid_str(sheet_id_str)
                    .map_err(|e| Error::from_reason(format!("invalid sheetId: {e}")))?;
                LockScope::Structural { sheet_id }
            }
            _ => {
                return Err(Error::from_reason(
                    "scope.type must be 'sheet', 'workbook', or 'structural'",
                ));
            }
        };

        coord
            .acquire_lock(&owner, scope, Duration::from_millis(ttl_ms as u64))
            .map(|id| id.to_string())
            .map_err(|e| Error::from_reason(format!("{e}")))
    })?
}

#[napi(js_name = "coordinator_release_lock")]
pub fn coordinator_release_lock(handle: u32, owner: String, lock_id: String) -> Result<()> {
    with_coordinator(handle, |coord| {
        let id = uuid::Uuid::parse_str(&lock_id)
            .map_err(|e| Error::from_reason(format!("invalid lock ID: {e}")))?;
        coord
            .release_lock(&owner, &id)
            .map_err(|e| Error::from_reason(format!("{e}")))
    })?
}

#[napi(js_name = "coordinator_expire_locks")]
pub fn coordinator_expire_locks(handle: u32) -> Result<Vec<String>> {
    with_coordinator(handle, |coord| {
        coord
            .expire_locks()
            .into_iter()
            .map(|id| id.to_string())
            .collect()
    })
}

/// Acquire a structural lock on a sheet. Serializes insert/delete row/col ops.
/// Returns the lock ID string, or throws if the lock is held by another participant.
#[napi(js_name = "coordinator_acquire_structural_lock")]
pub fn coordinator_acquire_structural_lock(
    handle: u32,
    owner: String,
    sheet_id: String,
    ttl_ms: u32,
) -> Result<String> {
    with_coordinator(handle, |coord| {
        let sid = SheetId::from_uuid_str(&sheet_id)
            .map_err(|e| Error::from_reason(format!("invalid sheetId: {e}")))?;
        coord
            .acquire_structural_lock(&owner, sid, Duration::from_millis(ttl_ms as u64))
            .map(|id| id.to_string())
            .map_err(|e| Error::from_reason(format!("{e}")))
    })?
}

/// Release a structural lock. Same as coordinator_release_lock but named for clarity.
#[napi(js_name = "coordinator_release_structural_lock")]
pub fn coordinator_release_structural_lock(
    handle: u32,
    owner: String,
    lock_id: String,
) -> Result<()> {
    with_coordinator(handle, |coord| {
        let id = uuid::Uuid::parse_str(&lock_id)
            .map_err(|e| Error::from_reason(format!("invalid lock ID: {e}")))?;
        coord
            .release_structural_lock(&owner, &id)
            .map_err(|e| Error::from_reason(format!("{e}")))
    })?
}

#[napi(js_name = "coordinator_active_locks")]
pub fn coordinator_active_locks(handle: u32) -> Result<String> {
    with_coordinator(handle, |coord| {
        let locks: Vec<serde_json::Value> = coord
            .active_locks()
            .iter()
            .map(|l| {
                serde_json::json!({
                    "id": l.id.to_string(),
                    "owner": l.owner,
                    "scope": lock_scope_to_json(&l.scope),
                })
            })
            .collect();
        serde_json::to_string(&locks).unwrap()
    })
}

// ---------------------------------------------------------------------------
// Awareness
// ---------------------------------------------------------------------------

#[napi(js_name = "coordinator_awareness_set_state")]
pub fn coordinator_awareness_set_state(
    handle: u32,
    participant_id: String,
    state_json: String,
) -> Result<Buffer> {
    with_coordinator(handle, |coord| {
        Buffer::from(coord.awareness_set_state(&participant_id, &state_json))
    })
}

#[napi(js_name = "coordinator_awareness_remove_state")]
pub fn coordinator_awareness_remove_state(handle: u32, participant_id: String) -> Result<Buffer> {
    with_coordinator(handle, |coord| {
        Buffer::from(coord.awareness_remove_state(&participant_id))
    })
}

#[napi(js_name = "coordinator_awareness_get_states")]
pub fn coordinator_awareness_get_states(handle: u32) -> Result<String> {
    with_coordinator(handle, |coord| coord.awareness_get_states())
}

#[napi(js_name = "coordinator_awareness_apply_update")]
pub fn coordinator_awareness_apply_update(handle: u32, update: Buffer) -> Result<Buffer> {
    with_coordinator(handle, |coord| {
        coord
            .awareness_apply_update(&update)
            .map(Buffer::from)
            .map_err(|e| Error::from_reason(format!("{e}")))
    })?
}

#[napi(js_name = "coordinator_awareness_full_state")]
pub fn coordinator_awareness_full_state(handle: u32) -> Result<Buffer> {
    with_coordinator(handle, |coord| Buffer::from(coord.awareness_full_state()))
}
