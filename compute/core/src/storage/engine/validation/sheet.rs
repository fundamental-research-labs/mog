use super::super::YrsComputeEngine;
use cell_types::SheetId;
use compute_document::hex::hex_to_id;
use value_types::ComputeError;

const MAX_SHEET_NAME_LEN: usize = 31;
const FORBIDDEN_CHARS: &[char] = &['\\', '/', '?', '*', '[', ']', ':'];

pub fn validate_sheet_name(name: &str) -> Result<(), ComputeError> {
    if name.trim().is_empty() {
        return Err(ComputeError::InvalidInput {
            message: "Sheet name cannot be empty or whitespace-only".into(),
        });
    }
    if name.len() > MAX_SHEET_NAME_LEN {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Sheet name exceeds {} characters: \"{}\"",
                MAX_SHEET_NAME_LEN, name
            ),
        });
    }
    if let Some(ch) = name.chars().find(|c| FORBIDDEN_CHARS.contains(c)) {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Sheet name contains forbidden character '{}': \"{}\"",
                ch, name
            ),
        });
    }
    Ok(())
}

pub fn validate_sheet_name_unique(
    name: &str,
    engine: &YrsComputeEngine,
) -> Result<(), ComputeError> {
    let name_lower = name.to_lowercase();
    for sid_hex in engine.get_all_sheet_ids() {
        let Some(raw) = hex_to_id(&sid_hex) else {
            continue;
        };
        let sid = SheetId::from_raw(raw);
        if let Some(existing) = engine.get_sheet_name(&sid)
            && existing.to_lowercase() == name_lower
        {
            return Err(ComputeError::InvalidInput {
                message: format!("Sheet name \"{}\" already exists", name),
            });
        }
    }
    Ok(())
}

pub fn validate_sheet_name_unique_excluding(
    name: &str,
    exclude_id: &SheetId,
    engine: &YrsComputeEngine,
) -> Result<(), ComputeError> {
    let name_lower = name.to_lowercase();
    for sid_hex in engine.get_all_sheet_ids() {
        let Some(raw) = hex_to_id(&sid_hex) else {
            continue;
        };
        let sid = SheetId::from_raw(raw);
        if &sid == exclude_id {
            continue;
        }
        if let Some(existing) = engine.get_sheet_name(&sid)
            && existing.to_lowercase() == name_lower
        {
            return Err(ComputeError::InvalidInput {
                message: format!("Sheet name \"{}\" already exists", name),
            });
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub fn validate_sheet_index(index: i32, sheet_count: usize) -> Result<(), ComputeError> {
    if index < 0 || index as usize > sheet_count {
        return Err(ComputeError::InvalidInput {
            message: format!("Sheet index must be 0..{}, got {}", sheet_count, index),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_sheet_name() {
        assert!(validate_sheet_name("").is_err());
        assert!(validate_sheet_name("   ").is_err());
    }

    #[test]
    fn rejects_long_sheet_name() {
        let long_name = "a".repeat(32);
        assert!(validate_sheet_name(&long_name).is_err());
    }

    #[test]
    fn rejects_forbidden_chars() {
        for ch in &['\\', '/', '?', '*', '[', ']', ':'] {
            let name = format!("Sheet{}", ch);
            assert!(
                validate_sheet_name(&name).is_err(),
                "Should reject '{}'",
                ch
            );
        }
    }

    #[test]
    fn accepts_valid_sheet_name() {
        assert!(validate_sheet_name("Sheet1").is_ok());
        assert!(validate_sheet_name("My Data").is_ok());
        assert!(validate_sheet_name("a".repeat(31).as_str()).is_ok());
    }

    #[test]
    fn rejects_negative_sheet_index() {
        assert!(validate_sheet_index(-1, 3).is_err());
    }

    #[test]
    fn accepts_valid_sheet_index() {
        assert!(validate_sheet_index(0, 3).is_ok());
        assert!(validate_sheet_index(3, 3).is_ok()); // insert at end
    }

    #[test]
    fn rejects_sheet_index_beyond_count() {
        assert!(validate_sheet_index(4, 3).is_err());
    }
}
