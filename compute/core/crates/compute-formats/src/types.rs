//! Token types and format structures for the Excel number format engine.

/// A single token in a parsed format code section.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Token {
    /// `0` -- digit placeholder, shows 0 if no digit
    Zero,
    /// `#` -- digit placeholder, omits if no digit
    Hash,
    /// `?` -- digit placeholder, shows space if no digit
    Question,
    /// `.` -- decimal point
    DecimalPoint,
    /// `,` -- thousands separator (between digit placeholders, not trailing)
    ThousandsSep,
    /// `,` -- scale divisor (trailing comma after last digit placeholder)
    ScaleDivisor,
    /// `%` -- percent (multiply by 100)
    Percent,
    /// `E+` or `E-` followed by digit placeholders
    Exponent {
        plus_sign: bool,
    },
    /// Literal character(s) -- from quotes, backslash escape, or currency
    Literal(String),
    /// `_x` -- skip width of character x (rendered as space)
    SkipWidth(char),
    /// `*x` -- repeat fill character x
    RepeatFill(char),
    /// `@` -- text placeholder (inserts the text value)
    TextPlaceholder,
    /// `[Color]` or `[Red]` etc. -- color directive (ignored for string output)
    Color(String),
    /// `[condition]` like `[>100]` -- conditional (parsed but advanced)
    Condition(String),
    // Date/time tokens
    DateYear4,     // yyyy
    DateYear2,     // yy
    DateMonth2,    // mm (resolved later -- could be minute)
    DateMonth1,    // m  (resolved later -- could be minute)
    DateDay2,      // dd
    DateDay1,      // d
    DateHour2,     // hh
    DateHour1,     // h
    DateMinute2,   // mm (after resolution)
    DateMinute1,   // m  (after resolution)
    DateSecond2,   // ss
    DateSecond1,   // s
    AmPm(String),  // AM/PM, am/pm, A/P
    FractionSlash, // fraction display ?/? or ?/N
    /// Literal denominator digits in fixed-denominator fraction formats, e.g. `4` in `# ?/4`.
    FractionDenominatorLiteral(String),
    ElapsedHours,   // [h] or [hh] -- total hours (no mod 24)
    ElapsedMinutes, // [m] or [mm] -- total minutes
    ElapsedSeconds, // [s] or [ss] -- total seconds
    DateDayName3,   // ddd (Mon, Tue, ...)
    DateDayName4,   // dddd (Monday, Tuesday, ...)
    DateMonthName3, // mmm (Jan, Feb, ...)
    DateMonthName4, // mmmm (January, February, ...)
    DateMonthName5, // mmmmm (J, F, ...)
}

pub(crate) fn is_datetime_token(tok: &Token) -> bool {
    matches!(
        tok,
        Token::DateYear4
            | Token::DateYear2
            | Token::DateMonth2
            | Token::DateMonth1
            | Token::DateDay2
            | Token::DateDay1
            | Token::DateHour2
            | Token::DateHour1
            | Token::DateMinute2
            | Token::DateMinute1
            | Token::DateSecond2
            | Token::DateSecond1
            | Token::AmPm(_)
            | Token::ElapsedHours
            | Token::ElapsedMinutes
            | Token::ElapsedSeconds
            | Token::DateDayName3
            | Token::DateDayName4
            | Token::DateMonthName3
            | Token::DateMonthName4
            | Token::DateMonthName5
    )
}

pub(crate) fn is_digit_placeholder(tok: &Token) -> bool {
    matches!(tok, Token::Zero | Token::Hash | Token::Question)
}

/// A single section of a format code.
#[derive(Debug, Clone)]
#[allow(clippy::struct_excessive_bools)] // These flags mirror Excel's section properties
pub(crate) struct FormatSection {
    pub(crate) tokens: Vec<Token>,
    pub(crate) is_datetime: bool,
    pub(crate) is_text_section: bool,
    /// Number of trailing commas (scale divisors: each divides by 1000).
    pub(crate) scale_divisors: u32,
    pub(crate) has_percent: bool,
    pub(crate) has_exponent: bool,
    /// Whether the section has a thousands separator comma.
    pub(crate) has_thousands: bool,
    /// Number of integer digit placeholders (0, #, ?).
    pub(crate) int_placeholders: usize,
    /// Number of decimal digit placeholders.
    pub(crate) dec_placeholders: usize,
    pub(crate) has_digit_placeholders: bool,
    /// Color directive from the format code (e.g., "Red", "Color3").
    pub(crate) color: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct FormatCode {
    pub(crate) sections: Vec<FormatSection>,
}
