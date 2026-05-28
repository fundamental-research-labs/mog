use super::types::ParseMode;

/// Convert mode integer to ParseMode enum
///
/// # Arguments
/// * `mode` - 0=Strict, 1=Lenient, 2=Permissive
pub fn mode_from_u32(mode: u32) -> ParseMode {
    match mode {
        0 => ParseMode::Strict,
        1 => ParseMode::Lenient,
        2 => ParseMode::Permissive,
        _ => ParseMode::Lenient,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mode_from_u32() {
        assert_eq!(mode_from_u32(0), ParseMode::Strict);
        assert_eq!(mode_from_u32(1), ParseMode::Lenient);
        assert_eq!(mode_from_u32(2), ParseMode::Permissive);
        assert_eq!(mode_from_u32(3), ParseMode::Lenient);
        assert_eq!(mode_from_u32(100), ParseMode::Lenient);
        assert_eq!(mode_from_u32(u32::MAX), ParseMode::Lenient);
    }

    #[test]
    fn output_results_mode_from_u32_matches_error_facade() {
        for mode in [0, 1, 2, u32::MAX] {
            assert_eq!(
                crate::output::results::mode_from_u32(mode),
                crate::infra::error::mode_from_u32(mode)
            );
        }
    }
}
