//! PureFunction trait — the core abstraction for all Excel-compatible functions.

use value_types::CellValue;
use value_types::DateSystem;

/// Legacy single-byte character sets supported by CHAR and CODE.
///
/// The numeric identifiers match Microsoft's code-page identifiers: 1252 is
/// Windows ANSI / Western European and 10000 is Macintosh Roman. Keeping this
/// as an enum prevents an unsupported or multibyte encoding from accidentally
/// entering the CHAR/CODE contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharCodePage {
    /// Windows ANSI / Western European (Windows-1252).
    Windows1252,
    /// Macintosh Roman / Western European (Mac code page 10000).
    Macintosh,
}

impl CharCodePage {
    /// Microsoft's numeric identifier for this code page.
    pub const fn code_page_id(self) -> u16 {
        match self {
            Self::Windows1252 => 1252,
            Self::Macintosh => 10000,
        }
    }

    /// Resolve one of the supported numeric code-page identifiers.
    pub const fn from_code_page_id(code_page: u16) -> Option<Self> {
        match code_page {
            1252 => Some(Self::Windows1252),
            10000 => Some(Self::Macintosh),
            _ => None,
        }
    }
}

impl Default for CharCodePage {
    fn default() -> Self {
        Self::Windows1252
    }
}

/// Stable CHAR/CODE default used by the workbook evaluator.
///
/// Excel's Windows implementation calls this character set "ANSI". Mog keeps
/// this as an explicit workbook-evaluation contract rather than looking at the
/// host operating system, because an evaluator may run on a different platform
/// from the workbook's origin. Callers evaluating a Macintosh-origin workbook
/// can select [`CharCodePage::Macintosh`] explicitly.
pub const DEFAULT_CHAR_CODE_PAGE: CharCodePage = CharCodePage::Windows1252;

/// Immutable workbook options that affect value-to-value function evaluation.
#[derive(Debug, Clone, Copy)]
pub struct FunctionContext {
    /// Whether calendar serials use January 1, 1904 as day zero.
    pub date1904: bool,

    /// Code page used by the legacy single-byte `CHAR`/`CODE` functions.
    ///
    /// The field is an explicit code-page choice so the contract is independent
    /// of the runtime host. Supported values are [`CharCodePage::Windows1252`]
    /// and [`CharCodePage::Macintosh`].
    pub char_code_page: CharCodePage,
}

impl FunctionContext {
    /// The workbook date-system policy used by date serial boundaries.
    #[inline]
    pub const fn date_system(self) -> DateSystem {
        DateSystem::from_date1904(self.date1904)
    }

    /// Convert a workbook-relative date serial to the canonical 1900 serial
    /// expected by the low-level date helpers.
    #[inline]
    pub const fn to_canonical_date_serial(self, serial: f64) -> f64 {
        self.date_system().to_canonical_serial(serial)
    }

    /// Convert a canonical 1900 date serial to the workbook-relative serial
    /// returned by date functions.
    #[inline]
    pub const fn from_canonical_date_serial(self, serial: f64) -> f64 {
        self.date_system().from_canonical_serial(serial)
    }
}

impl Default for FunctionContext {
    fn default() -> Self {
        Self {
            date1904: false,
            char_code_page: DEFAULT_CHAR_CODE_PAGE,
        }
    }
}

/// Trait implemented by every Excel-compatible function.
///
/// Functions receive pre-evaluated, flattened arguments as `&[CellValue]`.
/// Pure functions are stateless transformations from values to a value.
pub trait PureFunction: Send + Sync {
    /// Execute the function with the given arguments.
    fn call(&self, args: &[CellValue]) -> CellValue;

    /// Execute with explicit workbook options. Context-independent functions
    /// retain their ordinary value-to-value implementation.
    fn call_with_context(&self, args: &[CellValue], _context: &FunctionContext) -> CellValue {
        self.call(args)
    }

    /// The canonical (uppercase) name of the function.
    fn name(&self) -> &'static str;

    /// Minimum number of arguments required.
    fn min_args(&self) -> usize;

    /// Maximum number of arguments allowed, or `None` for unlimited (variadic).
    fn max_args(&self) -> Option<usize>;

    /// Whether this function is volatile (must recalculate every time).
    fn is_volatile(&self) -> bool {
        false
    }

    /// Whether this function returns an array (dynamic array formula).
    fn returns_array(&self) -> bool {
        false
    }

    /// Default value for an omitted optional argument at the given index.
    fn default_for_arg(&self, _index: usize) -> Option<CellValue> {
        None
    }

    /// Whether the argument at `index` is scalar (should be auto-lifted
    /// element-wise when an array value arrives).
    ///
    /// Default `false` means the function handles arrays natively (e.g.
    /// LARGE, STDEV, MEDIAN use `flatten_values`).  Override with `true`
    /// for scalar functions (ABS, TEXT, ROUND, etc.) so the registry's
    /// `try_array_lift` broadcasts them automatically.
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
}
