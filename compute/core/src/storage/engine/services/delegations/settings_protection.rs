use crate::snapshot::{ChangeKind, MutationResult, SheetSettingsChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{protection, settings};
use cell_types::SheetId;
use domain_types::domain::sheet::SheetSettings;
use value_types::ComputeError;

// -------------------------------------------------------------------
// Sheet settings
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_sheet_settings(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetSettings {
    settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_sheet_setting(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    key: &str,
    value: &str,
) -> Result<MutationResult, ComputeError> {
    settings::set_sheet_setting(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        key,
        value,
    );
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: key.to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok(result)
}

// -------------------------------------------------------------------
// Sheet protection
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn protect_sheet(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    protection::protect_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        password_hash,
    );
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: "protectionDetails".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn unprotect_sheet(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    let success = protection::unprotect_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        password_hash,
    );
    if !success {
        return Err(ComputeError::InvalidInput {
            message: "Incorrect password".to_string(),
        });
    }
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: "protectionDetails".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok(result)
}
