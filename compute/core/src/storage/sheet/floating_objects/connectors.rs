use super::state::state;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObjectData;

/// Find native connectors whose endpoints reference a shape.
pub fn find_connectors_for_shape(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    shape: &str,
) -> Vec<(String, serde_json::Value)> {
    let Some(state) = state(storage, sheet) else {
        return Vec::new();
    };
    state
        .objects
        .iter()
        .filter_map(|(id, object)| {
            let FloatingObjectData::Connector(connector) = &object.data else {
                return None;
            };
            if connector
                .start_connection
                .as_ref()
                .is_some_and(|connection| connection.shape_id == shape)
                || connector
                    .end_connection
                    .as_ref()
                    .is_some_and(|connection| connection.shape_id == shape)
            {
                Some((id.clone(), serde_json::to_value(object.as_ref()).ok()?))
            } else {
                None
            }
        })
        .collect()
}
