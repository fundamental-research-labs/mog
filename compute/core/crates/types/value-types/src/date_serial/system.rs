//! Workbook date-system serial boundaries.
//!
//! The calendar helpers in this module use the canonical Excel 1900 serial
//! system. Formula and storage boundaries may instead use the workbook's 1904
//! serial system, so that conversion belongs in this dependency-neutral layer.

/// Workbook calendar serial system.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum DateSystem {
    /// Excel's 1900 serial system, including the serial-60 compatibility day.
    #[default]
    Date1900,
    /// Excel's 1904 serial system, whose serial zero is 1904-01-01.
    Date1904,
}

impl DateSystem {
    /// Number of serial days between the canonical 1900 and 1904 systems.
    pub const DATE_SYSTEM_1904_OFFSET: f64 = 1462.0;

    /// Select the workbook serial system from its file-level date1904 flag.
    #[inline]
    #[must_use]
    pub const fn from_date1904(date1904: bool) -> Self {
        if date1904 {
            Self::Date1904
        } else {
            Self::Date1900
        }
    }

    /// Convert a workbook serial to the canonical 1900 serial expected by the
    /// low-level date helpers.
    #[inline]
    #[must_use]
    pub const fn to_canonical_serial(self, serial: f64) -> f64 {
        match self {
            Self::Date1900 => serial,
            Self::Date1904 => serial + Self::DATE_SYSTEM_1904_OFFSET,
        }
    }

    /// Convert a canonical 1900 serial to the workbook's serial system.
    #[inline]
    #[must_use]
    pub const fn from_canonical_serial(self, serial: f64) -> f64 {
        match self {
            Self::Date1900 => serial,
            Self::Date1904 => serial - Self::DATE_SYSTEM_1904_OFFSET,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::DateSystem;

    #[test]
    fn date_system_conversion_preserves_canonical_and_fractional_values() {
        let canonical = 45_292.75;
        assert_eq!(
            DateSystem::Date1900.to_canonical_serial(canonical),
            canonical
        );
        assert_eq!(
            DateSystem::Date1904.to_canonical_serial(43_830.75),
            canonical
        );
        assert_eq!(
            DateSystem::Date1904.from_canonical_serial(canonical),
            43_830.75
        );
    }

    #[test]
    fn date_system_1904_serial_zero_is_canonical_1904_epoch() {
        assert_eq!(DateSystem::from_date1904(false), DateSystem::Date1900);
        assert_eq!(DateSystem::from_date1904(true), DateSystem::Date1904);
        assert_eq!(
            DateSystem::Date1904.to_canonical_serial(0.0),
            DateSystem::DATE_SYSTEM_1904_OFFSET
        );
    }
}
