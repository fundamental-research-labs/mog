//! Culture information for number, date, and currency formatting.
//!
//! Provides culture-aware formatting options: decimal/thousands separators,
//! currency symbols, date patterns, and localized month/day names.

/// Date order for locale-aware date formatting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DateOrder {
    /// Month/Day/Year (US)
    MDY,
    /// Day/Month/Year (EU)
    DMY,
    /// Year/Month/Day (ISO)
    YMD,
}

/// Full culture information for locale-aware formatting.
///
/// Matches the TypeScript `CultureInfo` interface 1:1 for bridge-ts compatibility.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CultureInfo {
    // -- Identification --
    /// IETF culture tag, e.g. "en-US"
    pub name: String,
    /// Display name, e.g. "English (United States)"
    pub display_name: String,
    /// Native display name, e.g. "日本語 (日本)"
    pub native_name: String,
    /// ISO 639-1 two-letter language code, e.g. "en"
    pub two_letter_language_code: String,

    // -- Number --
    /// Decimal separator (default: ".")
    pub decimal_separator: String,
    /// Thousands separator (default: ",")
    pub thousands_separator: String,
    /// Negative sign (default: "-")
    pub negative_sign: String,
    /// Positive sign (default: "+")
    pub positive_sign: String,
    /// Negative number pattern (always 1)
    pub negative_number_pattern: u8,
    /// Number group size (always 3)
    pub number_group_size: u8,

    // -- Percent --
    /// Percent symbol (default: "%")
    pub percent_symbol: String,
    /// Per-mille symbol (default: "‰")
    pub per_mille_symbol: String,
    /// Percent positive pattern
    pub percent_positive_pattern: u8,
    /// Percent negative pattern
    pub percent_negative_pattern: u8,

    // -- Currency --
    /// Currency symbol, e.g. "$", "€", "¥"
    pub currency_symbol: String,
    /// ISO 4217 currency code, e.g. "USD", "EUR"
    pub currency_code: String,
    /// .NET `CurrencyPositivePattern` (0-3)
    pub currency_positive_pattern: u8,
    /// .NET `CurrencyNegativePattern` (0-15)
    pub currency_negative_pattern: u8,
    /// Decimal digits for currency display
    pub currency_decimal_digits: u8,

    // -- Date/Time --
    /// Date separator, e.g. "/", ".", "-"
    pub date_separator: String,
    /// Time separator (always ":")
    pub time_separator: String,
    /// Short date pattern, e.g. "M/d/yyyy"
    pub short_date_pattern: String,
    /// Long date pattern, e.g. "dddd, MMMM d, yyyy"
    pub long_date_pattern: String,
    /// Short time pattern, e.g. "h:mm tt"
    pub short_time_pattern: String,
    /// Long time pattern, e.g. "h:mm:ss tt"
    pub long_time_pattern: String,
    /// AM designator
    pub am_designator: String,
    /// PM designator
    pub pm_designator: String,

    // -- Calendar --
    /// First day of week: 0=Sunday, 1=Monday
    pub first_day_of_week: u8,
    /// Full month names (January..December)
    pub month_names: [String; 12],
    /// Abbreviated month names (Jan..Dec)
    pub abbreviated_month_names: [String; 12],
    /// Full day names (Sunday..Saturday)
    pub day_names: [String; 7],
    /// Abbreviated day names (Sun..Sat)
    pub abbreviated_day_names: [String; 7],
    /// Shortest day names (Su, Mo, ...)
    pub shortest_day_names: [String; 7],

    // -- Boolean/List --
    /// Localized TRUE string
    pub true_string: String,
    /// Localized FALSE string
    pub false_string: String,
    /// List separator ("," or ";")
    pub list_separator: String,
}

impl Default for CultureInfo {
    fn default() -> Self {
        Self {
            name: "en-US".to_string(),
            display_name: "English (United States)".to_string(),
            native_name: "English (United States)".to_string(),
            two_letter_language_code: "en".to_string(),

            decimal_separator: ".".to_string(),
            thousands_separator: ",".to_string(),
            negative_sign: "-".to_string(),
            positive_sign: "+".to_string(),
            negative_number_pattern: 1,
            number_group_size: 3,

            percent_symbol: "%".to_string(),
            per_mille_symbol: "\u{2030}".to_string(),
            percent_positive_pattern: 1,
            percent_negative_pattern: 1,

            currency_symbol: "$".to_string(),
            currency_code: "USD".to_string(),
            currency_positive_pattern: 0,
            currency_negative_pattern: 0,
            currency_decimal_digits: 2,

            date_separator: "/".to_string(),
            time_separator: ":".to_string(),
            short_date_pattern: "M/d/yyyy".to_string(),
            long_date_pattern: "dddd, MMMM d, yyyy".to_string(),
            short_time_pattern: "h:mm tt".to_string(),
            long_time_pattern: "h:mm:ss tt".to_string(),
            am_designator: "AM".to_string(),
            pm_designator: "PM".to_string(),

            first_day_of_week: 0,
            month_names: arr12([
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
            ]),
            abbreviated_month_names: arr12([
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ]),
            day_names: arr7(
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
            ),
            abbreviated_day_names: arr7("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"),
            shortest_day_names: arr7("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"),

            true_string: "TRUE".to_string(),
            false_string: "FALSE".to_string(),
            list_separator: ",".to_string(),
        }
    }
}

impl CultureInfo {
    /// Derive date component ordering from `short_date_pattern`.
    pub fn date_order(&self) -> DateOrder {
        for ch in self.short_date_pattern.chars() {
            match ch {
                'M' => return DateOrder::MDY,
                'd' => return DateOrder::DMY,
                'y' => return DateOrder::YMD,
                _ => {}
            }
        }
        DateOrder::MDY // fallback
    }

    /// Derive 24-hour preference from `short_time_pattern`.
    /// If pattern contains 't' (AM/PM marker), it's 12-hour.
    pub fn use_24_hour(&self) -> bool {
        !self.short_time_pattern.contains('t')
    }
}

// ---------------------------------------------------------------------------
// Culture → CultureInfo mapping
// ---------------------------------------------------------------------------

/// Build a [`CultureInfo`] from an IETF culture tag (e.g., `"de-DE"`).
///
/// Supports 10 cultures: en-US, en-GB, de-DE, fr-FR, es-ES, it-IT, pt-BR,
/// ja-JP, zh-CN, ko-KR. Unknown tags fall back to en-US defaults.
///
/// # Examples
///
/// ```
/// use compute_formats::get_culture;
///
/// let de = get_culture("de-DE");
/// assert_eq!(de.decimal_separator, ",");
/// assert_eq!(de.thousands_separator, ".");
///
/// // Unknown tags return en-US:
/// let unknown = get_culture("xx-XX");
/// assert_eq!(unknown.name, "en-US");
/// ```
#[must_use]
#[allow(clippy::too_many_lines)] // culture data table is inherently long
pub fn get_culture(culture: &str) -> CultureInfo {
    match culture {
        // en-US is the default — falls through to _ arm intentionally
        "en-GB" => CultureInfo {
            name: "en-GB".into(),
            display_name: "English (United Kingdom)".into(),
            native_name: "English (United Kingdom)".into(),
            currency_symbol: "\u{00a3}".into(), // £
            currency_code: "GBP".into(),
            currency_positive_pattern: 0,
            currency_negative_pattern: 1,
            short_date_pattern: "dd/MM/yyyy".into(),
            long_date_pattern: "dddd, d MMMM yyyy".into(),
            short_time_pattern: "HH:mm".into(),
            long_time_pattern: "HH:mm:ss".into(),
            first_day_of_week: 1,
            shortest_day_names: arr7("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"),
            ..Default::default()
        },

        "de-DE" => CultureInfo {
            name: "de-DE".into(),
            display_name: "German (Germany)".into(),
            native_name: "Deutsch (Deutschland)".into(),
            two_letter_language_code: "de".into(),
            decimal_separator: ",".into(),
            thousands_separator: ".".into(),
            percent_positive_pattern: 0,
            percent_negative_pattern: 0,
            currency_symbol: "\u{20ac}".into(), // €
            currency_code: "EUR".into(),
            currency_positive_pattern: 3,
            currency_negative_pattern: 8,
            date_separator: ".".into(),
            short_date_pattern: "dd.MM.yyyy".into(),
            long_date_pattern: "dddd, d. MMMM yyyy".into(),
            short_time_pattern: "HH:mm".into(),
            long_time_pattern: "HH:mm:ss".into(),
            am_designator: String::new(),
            pm_designator: String::new(),
            first_day_of_week: 1,
            month_names: arr12([
                "Januar",
                "Februar",
                "M\u{00e4}rz",
                "April",
                "Mai",
                "Juni",
                "Juli",
                "August",
                "September",
                "Oktober",
                "November",
                "Dezember",
            ]),
            abbreviated_month_names: arr12([
                "Jan",
                "Feb",
                "M\u{00e4}r",
                "Apr",
                "Mai",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Okt",
                "Nov",
                "Dez",
            ]),
            day_names: arr7(
                "Sonntag",
                "Montag",
                "Dienstag",
                "Mittwoch",
                "Donnerstag",
                "Freitag",
                "Samstag",
            ),
            abbreviated_day_names: arr7("So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"),
            shortest_day_names: arr7("So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"),
            true_string: "WAHR".into(),
            false_string: "FALSCH".into(),
            list_separator: ";".into(),
            ..Default::default()
        },

        "fr-FR" => CultureInfo {
            name: "fr-FR".into(),
            display_name: "French (France)".into(),
            native_name: "fran\u{00e7}ais (France)".into(),
            two_letter_language_code: "fr".into(),
            decimal_separator: ",".into(),
            thousands_separator: "\u{00A0}".into(), // non-breaking space
            percent_positive_pattern: 0,
            percent_negative_pattern: 0,
            currency_symbol: "\u{20ac}".into(), // €
            currency_code: "EUR".into(),
            currency_positive_pattern: 3,
            currency_negative_pattern: 8,
            short_date_pattern: "dd/MM/yyyy".into(),
            long_date_pattern: "dddd d MMMM yyyy".into(),
            short_time_pattern: "HH:mm".into(),
            long_time_pattern: "HH:mm:ss".into(),
            am_designator: String::new(),
            pm_designator: String::new(),
            first_day_of_week: 1,
            month_names: arr12([
                "janvier",
                "f\u{00e9}vrier",
                "mars",
                "avril",
                "mai",
                "juin",
                "juillet",
                "ao\u{00fb}t",
                "septembre",
                "octobre",
                "novembre",
                "d\u{00e9}cembre",
            ]),
            abbreviated_month_names: arr12([
                "janv.",
                "f\u{00e9}vr.",
                "mars",
                "avr.",
                "mai",
                "juin",
                "juil.",
                "ao\u{00fb}t",
                "sept.",
                "oct.",
                "nov.",
                "d\u{00e9}c.",
            ]),
            day_names: arr7(
                "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi",
            ),
            abbreviated_day_names: arr7("dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."),
            shortest_day_names: arr7("di", "lu", "ma", "me", "je", "ve", "sa"),
            true_string: "VRAI".into(),
            false_string: "FAUX".into(),
            list_separator: ";".into(),
            ..Default::default()
        },

        "es-ES" => CultureInfo {
            name: "es-ES".into(),
            display_name: "Spanish (Spain)".into(),
            native_name: "espa\u{00f1}ol (Espa\u{00f1}a)".into(),
            two_letter_language_code: "es".into(),
            decimal_separator: ",".into(),
            thousands_separator: ".".into(),
            percent_positive_pattern: 0,
            percent_negative_pattern: 0,
            currency_symbol: "\u{20ac}".into(), // €
            currency_code: "EUR".into(),
            currency_positive_pattern: 3,
            currency_negative_pattern: 8,
            short_date_pattern: "d/M/yyyy".into(),
            long_date_pattern: "dddd, d' de 'MMMM' de 'yyyy".into(),
            short_time_pattern: "H:mm".into(),
            long_time_pattern: "H:mm:ss".into(),
            am_designator: String::new(),
            pm_designator: String::new(),
            first_day_of_week: 1,
            month_names: arr12([
                "enero",
                "febrero",
                "marzo",
                "abril",
                "mayo",
                "junio",
                "julio",
                "agosto",
                "septiembre",
                "octubre",
                "noviembre",
                "diciembre",
            ]),
            abbreviated_month_names: arr12([
                "ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.",
                "nov.", "dic.",
            ]),
            day_names: arr7(
                "domingo",
                "lunes",
                "martes",
                "mi\u{00e9}rcoles",
                "jueves",
                "viernes",
                "s\u{00e1}bado",
            ),
            abbreviated_day_names: arr7(
                "dom.",
                "lun.",
                "mar.",
                "mi\u{00e9}.",
                "jue.",
                "vie.",
                "s\u{00e1}b.",
            ),
            shortest_day_names: arr7("D", "L", "M", "X", "J", "V", "S"),
            true_string: "VERDADERO".into(),
            false_string: "FALSO".into(),
            list_separator: ";".into(),
            ..Default::default()
        },

        "it-IT" => CultureInfo {
            name: "it-IT".into(),
            display_name: "Italian (Italy)".into(),
            native_name: "italiano (Italia)".into(),
            two_letter_language_code: "it".into(),
            decimal_separator: ",".into(),
            thousands_separator: ".".into(),
            percent_positive_pattern: 0,
            percent_negative_pattern: 0,
            currency_symbol: "\u{20ac}".into(), // €
            currency_code: "EUR".into(),
            currency_positive_pattern: 3,
            currency_negative_pattern: 8,
            short_date_pattern: "dd/MM/yyyy".into(),
            long_date_pattern: "dddd d MMMM yyyy".into(),
            short_time_pattern: "HH:mm".into(),
            long_time_pattern: "HH:mm:ss".into(),
            am_designator: String::new(),
            pm_designator: String::new(),
            first_day_of_week: 1,
            month_names: arr12([
                "gennaio",
                "febbraio",
                "marzo",
                "aprile",
                "maggio",
                "giugno",
                "luglio",
                "agosto",
                "settembre",
                "ottobre",
                "novembre",
                "dicembre",
            ]),
            abbreviated_month_names: arr12([
                "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic",
            ]),
            day_names: arr7(
                "domenica",
                "luned\u{00ec}",
                "marted\u{00ec}",
                "mercoled\u{00ec}",
                "gioved\u{00ec}",
                "venerd\u{00ec}",
                "sabato",
            ),
            abbreviated_day_names: arr7("dom", "lun", "mar", "mer", "gio", "ven", "sab"),
            shortest_day_names: arr7("do", "lu", "ma", "me", "gi", "ve", "sa"),
            true_string: "VERO".into(),
            false_string: "FALSO".into(),
            list_separator: ";".into(),
            ..Default::default()
        },

        "pt-BR" => CultureInfo {
            name: "pt-BR".into(),
            display_name: "Portuguese (Brazil)".into(),
            native_name: "portugu\u{00ea}s (Brasil)".into(),
            two_letter_language_code: "pt".into(),
            decimal_separator: ",".into(),
            thousands_separator: ".".into(),
            percent_positive_pattern: 1,
            percent_negative_pattern: 1,
            currency_symbol: "R$".into(),
            currency_code: "BRL".into(),
            currency_positive_pattern: 2,
            currency_negative_pattern: 9,
            short_date_pattern: "dd/MM/yyyy".into(),
            long_date_pattern: "dddd, d' de 'MMMM' de 'yyyy".into(),
            short_time_pattern: "HH:mm".into(),
            long_time_pattern: "HH:mm:ss".into(),
            am_designator: String::new(),
            pm_designator: String::new(),
            first_day_of_week: 0,
            month_names: arr12([
                "janeiro",
                "fevereiro",
                "mar\u{00e7}o",
                "abril",
                "maio",
                "junho",
                "julho",
                "agosto",
                "setembro",
                "outubro",
                "novembro",
                "dezembro",
            ]),
            abbreviated_month_names: arr12([
                "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
            ]),
            day_names: arr7(
                "domingo",
                "segunda-feira",
                "ter\u{00e7}a-feira",
                "quarta-feira",
                "quinta-feira",
                "sexta-feira",
                "s\u{00e1}bado",
            ),
            abbreviated_day_names: arr7("dom", "seg", "ter", "qua", "qui", "sex", "s\u{00e1}b"),
            shortest_day_names: arr7("D", "S", "T", "Q", "Q", "S", "S"),
            true_string: "VERDADEIRO".into(),
            false_string: "FALSO".into(),
            list_separator: ";".into(),
            ..Default::default()
        },

        "ja-JP" => CultureInfo {
            name: "ja-JP".into(),
            display_name: "Japanese (Japan)".into(),
            native_name: "\u{65e5}\u{672c}\u{8a9e} (\u{65e5}\u{672c})".into(),
            two_letter_language_code: "ja".into(),
            percent_positive_pattern: 1,
            percent_negative_pattern: 1,
            currency_symbol: "\u{00a5}".into(), // ¥
            currency_code: "JPY".into(),
            currency_positive_pattern: 0,
            currency_negative_pattern: 1,
            currency_decimal_digits: 0,
            short_date_pattern: "yyyy/MM/dd".into(),
            long_date_pattern: "yyyy\u{5e74}M\u{6708}d\u{65e5}".into(),
            short_time_pattern: "H:mm".into(),
            long_time_pattern: "H:mm:ss".into(),
            am_designator: "\u{5348}\u{524d}".into(), // 午前
            pm_designator: "\u{5348}\u{5f8c}".into(), // 午後
            first_day_of_week: 0,
            month_names: arr12([
                "1\u{6708}",
                "2\u{6708}",
                "3\u{6708}",
                "4\u{6708}",
                "5\u{6708}",
                "6\u{6708}",
                "7\u{6708}",
                "8\u{6708}",
                "9\u{6708}",
                "10\u{6708}",
                "11\u{6708}",
                "12\u{6708}",
            ]),
            abbreviated_month_names: arr12([
                "1\u{6708}",
                "2\u{6708}",
                "3\u{6708}",
                "4\u{6708}",
                "5\u{6708}",
                "6\u{6708}",
                "7\u{6708}",
                "8\u{6708}",
                "9\u{6708}",
                "10\u{6708}",
                "11\u{6708}",
                "12\u{6708}",
            ]),
            day_names: arr7(
                "\u{65e5}\u{66dc}\u{65e5}",
                "\u{6708}\u{66dc}\u{65e5}",
                "\u{706b}\u{66dc}\u{65e5}",
                "\u{6c34}\u{66dc}\u{65e5}",
                "\u{6728}\u{66dc}\u{65e5}",
                "\u{91d1}\u{66dc}\u{65e5}",
                "\u{571f}\u{66dc}\u{65e5}",
            ),
            abbreviated_day_names: arr7(
                "\u{65e5}", "\u{6708}", "\u{706b}", "\u{6c34}", "\u{6728}", "\u{91d1}", "\u{571f}",
            ),
            shortest_day_names: arr7(
                "\u{65e5}", "\u{6708}", "\u{706b}", "\u{6c34}", "\u{6728}", "\u{91d1}", "\u{571f}",
            ),
            ..Default::default()
        },

        "zh-CN" => CultureInfo {
            name: "zh-CN".into(),
            display_name: "Chinese (Simplified, China)".into(),
            native_name: "\u{4e2d}\u{6587}(\u{4e2d}\u{56fd})".into(),
            two_letter_language_code: "zh".into(),
            percent_positive_pattern: 1,
            percent_negative_pattern: 1,
            currency_symbol: "\u{00a5}".into(), // ¥
            currency_code: "CNY".into(),
            currency_positive_pattern: 0,
            currency_negative_pattern: 2,
            short_date_pattern: "yyyy/M/d".into(),
            long_date_pattern: "yyyy\u{5e74}M\u{6708}d\u{65e5}".into(),
            short_time_pattern: "H:mm".into(),
            long_time_pattern: "H:mm:ss".into(),
            am_designator: "\u{4e0a}\u{5348}".into(), // 上午
            pm_designator: "\u{4e0b}\u{5348}".into(), // 下午
            first_day_of_week: 0,
            month_names: arr12([
                "\u{4e00}\u{6708}",
                "\u{4e8c}\u{6708}",
                "\u{4e09}\u{6708}",
                "\u{56db}\u{6708}",
                "\u{4e94}\u{6708}",
                "\u{516d}\u{6708}",
                "\u{4e03}\u{6708}",
                "\u{516b}\u{6708}",
                "\u{4e5d}\u{6708}",
                "\u{5341}\u{6708}",
                "\u{5341}\u{4e00}\u{6708}",
                "\u{5341}\u{4e8c}\u{6708}",
            ]),
            abbreviated_month_names: arr12([
                "1\u{6708}",
                "2\u{6708}",
                "3\u{6708}",
                "4\u{6708}",
                "5\u{6708}",
                "6\u{6708}",
                "7\u{6708}",
                "8\u{6708}",
                "9\u{6708}",
                "10\u{6708}",
                "11\u{6708}",
                "12\u{6708}",
            ]),
            day_names: arr7(
                "\u{661f}\u{671f}\u{65e5}",
                "\u{661f}\u{671f}\u{4e00}",
                "\u{661f}\u{671f}\u{4e8c}",
                "\u{661f}\u{671f}\u{4e09}",
                "\u{661f}\u{671f}\u{56db}",
                "\u{661f}\u{671f}\u{4e94}",
                "\u{661f}\u{671f}\u{516d}",
            ),
            abbreviated_day_names: arr7(
                "\u{5468}\u{65e5}",
                "\u{5468}\u{4e00}",
                "\u{5468}\u{4e8c}",
                "\u{5468}\u{4e09}",
                "\u{5468}\u{56db}",
                "\u{5468}\u{4e94}",
                "\u{5468}\u{516d}",
            ),
            shortest_day_names: arr7(
                "\u{65e5}", "\u{4e00}", "\u{4e8c}", "\u{4e09}", "\u{56db}", "\u{4e94}", "\u{516d}",
            ),
            ..Default::default()
        },

        "ko-KR" => CultureInfo {
            name: "ko-KR".into(),
            display_name: "Korean (Korea)".into(),
            native_name: "\u{d55c}\u{ad6d}\u{c5b4}(\u{b300}\u{d55c}\u{bbfc}\u{ad6d})".into(),
            two_letter_language_code: "ko".into(),
            percent_positive_pattern: 1,
            percent_negative_pattern: 1,
            currency_symbol: "\u{20a9}".into(), // ₩
            currency_code: "KRW".into(),
            currency_positive_pattern: 0,
            currency_negative_pattern: 1,
            currency_decimal_digits: 0,
            date_separator: "-".into(),
            short_date_pattern: "yyyy-MM-dd".into(),
            long_date_pattern: "yyyy\u{b144} M\u{c6d4} d\u{c77c} dddd".into(),
            short_time_pattern: "tt h:mm".into(),
            long_time_pattern: "tt h:mm:ss".into(),
            am_designator: "\u{c624}\u{c804}".into(), // 오전
            pm_designator: "\u{c624}\u{d6c4}".into(), // 오후
            first_day_of_week: 0,
            month_names: arr12([
                "1\u{c6d4}",
                "2\u{c6d4}",
                "3\u{c6d4}",
                "4\u{c6d4}",
                "5\u{c6d4}",
                "6\u{c6d4}",
                "7\u{c6d4}",
                "8\u{c6d4}",
                "9\u{c6d4}",
                "10\u{c6d4}",
                "11\u{c6d4}",
                "12\u{c6d4}",
            ]),
            abbreviated_month_names: arr12([
                "1\u{c6d4}",
                "2\u{c6d4}",
                "3\u{c6d4}",
                "4\u{c6d4}",
                "5\u{c6d4}",
                "6\u{c6d4}",
                "7\u{c6d4}",
                "8\u{c6d4}",
                "9\u{c6d4}",
                "10\u{c6d4}",
                "11\u{c6d4}",
                "12\u{c6d4}",
            ]),
            day_names: arr7(
                "\u{c77c}\u{c694}\u{c77c}",
                "\u{c6d4}\u{c694}\u{c77c}",
                "\u{d654}\u{c694}\u{c77c}",
                "\u{c218}\u{c694}\u{c77c}",
                "\u{baa9}\u{c694}\u{c77c}",
                "\u{ae08}\u{c694}\u{c77c}",
                "\u{d1a0}\u{c694}\u{c77c}",
            ),
            abbreviated_day_names: arr7(
                "\u{c77c}", "\u{c6d4}", "\u{d654}", "\u{c218}", "\u{baa9}", "\u{ae08}", "\u{d1a0}",
            ),
            shortest_day_names: arr7(
                "\u{c77c}", "\u{c6d4}", "\u{d654}", "\u{c218}", "\u{baa9}", "\u{ae08}", "\u{d1a0}",
            ),
            ..Default::default()
        },

        // Unknown culture -> en-US defaults
        _ => CultureInfo::default(),
    }
}

/// Get all 10 supported cultures.
///
/// # Examples
///
/// ```
/// use compute_formats::get_all_cultures;
///
/// let cultures = get_all_cultures();
/// assert_eq!(cultures.len(), 10);
/// assert_eq!(cultures[0].name, "en-US");
/// ```
#[must_use]
pub fn get_all_cultures() -> Vec<CultureInfo> {
    vec![
        get_culture("en-US"),
        get_culture("en-GB"),
        get_culture("de-DE"),
        get_culture("fr-FR"),
        get_culture("es-ES"),
        get_culture("it-IT"),
        get_culture("pt-BR"),
        get_culture("ja-JP"),
        get_culture("zh-CN"),
        get_culture("ko-KR"),
    ]
}

/// Helper: build a 12-element String array from a &str slice array.
fn arr12(items: [&str; 12]) -> [String; 12] {
    items.map(Into::into)
}

/// Helper: build a 7-element String array from &str slices.
#[allow(clippy::many_single_char_names)] // short names are clear for array construction
fn arr7(a: &str, b: &str, c: &str, d: &str, e: &str, f: &str, g: &str) -> [String; 7] {
    [
        a.into(),
        b.into(),
        c.into(),
        d.into(),
        e.into(),
        f.into(),
        g.into(),
    ]
}

// ---------------------------------------------------------------------------
// Culture-aware helper functions
// ---------------------------------------------------------------------------

/// Return the full month name for `month_index` (0 = January, 11 = December).
///
/// Indices outside 0..12 wrap via modulo.
pub fn get_month_name(ci: &CultureInfo, month_index: usize) -> &str {
    &ci.month_names[month_index % 12]
}

/// Return the abbreviated month name for `month_index` (0 = January, 11 = December).
pub fn get_abbreviated_month_name(ci: &CultureInfo, month_index: usize) -> &str {
    &ci.abbreviated_month_names[month_index % 12]
}

/// Return the first letter of the full month name for `month_index`.
///
/// This is used by certain Excel format codes (e.g. `mmmmm`).
pub fn get_month_first_letter(ci: &CultureInfo, month_index: usize) -> &str {
    let name = get_month_name(ci, month_index);
    let first_char_len = name.chars().next().map_or(0, char::len_utf8);
    &name[..first_char_len]
}

/// Return the full day name for `day_of_week` (0 = Sunday, 6 = Saturday).
pub fn get_day_name(ci: &CultureInfo, day_of_week: usize) -> &str {
    &ci.day_names[day_of_week % 7]
}

/// Return the abbreviated day name for `day_of_week` (0 = Sunday, 6 = Saturday).
pub fn get_abbreviated_day_name(ci: &CultureInfo, day_of_week: usize) -> &str {
    &ci.abbreviated_day_names[day_of_week % 7]
}

/// Return the AM or PM designator based on the hour (0-23).
pub fn get_am_pm_designator(ci: &CultureInfo, hours: u32) -> &str {
    if hours < 12 {
        &ci.am_designator
    } else {
        &ci.pm_designator
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_locale_separators() {
        let ci = CultureInfo::default();
        assert_eq!(ci.decimal_separator, ".");
        assert_eq!(ci.thousands_separator, ",");
        assert_eq!(ci.currency_symbol, "$");
        assert_eq!(ci.date_order(), DateOrder::MDY);
        assert!(!ci.use_24_hour());
    }

    #[test]
    fn default_month_names_english() {
        let ci = CultureInfo::default();
        assert_eq!(get_month_name(&ci, 0), "January");
        assert_eq!(get_month_name(&ci, 1), "February");
        assert_eq!(get_month_name(&ci, 2), "March");
        assert_eq!(get_month_name(&ci, 3), "April");
        assert_eq!(get_month_name(&ci, 4), "May");
        assert_eq!(get_month_name(&ci, 5), "June");
        assert_eq!(get_month_name(&ci, 6), "July");
        assert_eq!(get_month_name(&ci, 7), "August");
        assert_eq!(get_month_name(&ci, 8), "September");
        assert_eq!(get_month_name(&ci, 9), "October");
        assert_eq!(get_month_name(&ci, 10), "November");
        assert_eq!(get_month_name(&ci, 11), "December");
    }

    #[test]
    fn default_abbreviated_month_names_english() {
        let ci = CultureInfo::default();
        assert_eq!(get_abbreviated_month_name(&ci, 0), "Jan");
        assert_eq!(get_abbreviated_month_name(&ci, 1), "Feb");
        assert_eq!(get_abbreviated_month_name(&ci, 2), "Mar");
        assert_eq!(get_abbreviated_month_name(&ci, 3), "Apr");
        assert_eq!(get_abbreviated_month_name(&ci, 4), "May");
        assert_eq!(get_abbreviated_month_name(&ci, 5), "Jun");
        assert_eq!(get_abbreviated_month_name(&ci, 6), "Jul");
        assert_eq!(get_abbreviated_month_name(&ci, 7), "Aug");
        assert_eq!(get_abbreviated_month_name(&ci, 8), "Sep");
        assert_eq!(get_abbreviated_month_name(&ci, 9), "Oct");
        assert_eq!(get_abbreviated_month_name(&ci, 10), "Nov");
        assert_eq!(get_abbreviated_month_name(&ci, 11), "Dec");
    }

    #[test]
    fn custom_month_names() {
        let ci = CultureInfo {
            month_names: [
                "Enero".to_string(),
                "Febrero".to_string(),
                "Marzo".to_string(),
                "Abril".to_string(),
                "Mayo".to_string(),
                "Junio".to_string(),
                "Julio".to_string(),
                "Agosto".to_string(),
                "Septiembre".to_string(),
                "Octubre".to_string(),
                "Noviembre".to_string(),
                "Diciembre".to_string(),
            ],
            ..Default::default()
        };
        assert_eq!(get_month_name(&ci, 0), "Enero");
        assert_eq!(get_month_name(&ci, 8), "Septiembre");
        assert_eq!(get_month_name(&ci, 11), "Diciembre");
    }

    #[test]
    fn month_first_letter() {
        let ci = CultureInfo::default();
        assert_eq!(get_month_first_letter(&ci, 0), "J");
        assert_eq!(get_month_first_letter(&ci, 1), "F");
        assert_eq!(get_month_first_letter(&ci, 4), "M");
        assert_eq!(get_month_first_letter(&ci, 7), "A");
        assert_eq!(get_month_first_letter(&ci, 11), "D");
    }

    #[test]
    fn month_first_letter_unicode() {
        let ci = CultureInfo {
            month_names: [
                "\u{00D6}cak".to_string(),
                "Feb".to_string(),
                "Mar".to_string(),
                "Apr".to_string(),
                "May".to_string(),
                "Jun".to_string(),
                "Jul".to_string(),
                "Aug".to_string(),
                "Sep".to_string(),
                "Oct".to_string(),
                "Nov".to_string(),
                "Dec".to_string(),
            ],
            ..Default::default()
        };
        assert_eq!(get_month_first_letter(&ci, 0), "\u{00D6}");
    }

    #[test]
    fn default_day_names_english() {
        let ci = CultureInfo::default();
        assert_eq!(get_day_name(&ci, 0), "Sunday");
        assert_eq!(get_day_name(&ci, 1), "Monday");
        assert_eq!(get_day_name(&ci, 2), "Tuesday");
        assert_eq!(get_day_name(&ci, 3), "Wednesday");
        assert_eq!(get_day_name(&ci, 4), "Thursday");
        assert_eq!(get_day_name(&ci, 5), "Friday");
        assert_eq!(get_day_name(&ci, 6), "Saturday");
    }

    #[test]
    fn default_abbreviated_day_names_english() {
        let ci = CultureInfo::default();
        assert_eq!(get_abbreviated_day_name(&ci, 0), "Sun");
        assert_eq!(get_abbreviated_day_name(&ci, 1), "Mon");
        assert_eq!(get_abbreviated_day_name(&ci, 2), "Tue");
        assert_eq!(get_abbreviated_day_name(&ci, 3), "Wed");
        assert_eq!(get_abbreviated_day_name(&ci, 4), "Thu");
        assert_eq!(get_abbreviated_day_name(&ci, 5), "Fri");
        assert_eq!(get_abbreviated_day_name(&ci, 6), "Sat");
    }

    #[test]
    fn custom_day_names() {
        let ci = CultureInfo {
            day_names: arr7(
                "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi",
            ),
            ..Default::default()
        };
        assert_eq!(get_day_name(&ci, 0), "Dimanche");
        assert_eq!(get_day_name(&ci, 3), "Mercredi");
        assert_eq!(get_day_name(&ci, 6), "Samedi");
    }

    #[test]
    fn am_pm_designator_default() {
        let ci = CultureInfo::default();
        assert_eq!(get_am_pm_designator(&ci, 0), "AM");
        assert_eq!(get_am_pm_designator(&ci, 6), "AM");
        assert_eq!(get_am_pm_designator(&ci, 11), "AM");
        assert_eq!(get_am_pm_designator(&ci, 12), "PM");
        assert_eq!(get_am_pm_designator(&ci, 18), "PM");
        assert_eq!(get_am_pm_designator(&ci, 23), "PM");
    }

    #[test]
    fn am_pm_designator_custom() {
        let ci = CultureInfo {
            am_designator: "\u{5348}\u{524d}".to_string(),
            pm_designator: "\u{5348}\u{5f8c}".to_string(),
            ..Default::default()
        };
        assert_eq!(get_am_pm_designator(&ci, 5), "\u{5348}\u{524d}");
        assert_eq!(get_am_pm_designator(&ci, 15), "\u{5348}\u{5f8c}");
    }

    #[test]
    fn month_index_wraps() {
        let ci = CultureInfo::default();
        assert_eq!(get_month_name(&ci, 12), "January");
        assert_eq!(get_month_name(&ci, 13), "February");
    }

    #[test]
    fn day_index_wraps() {
        let ci = CultureInfo::default();
        assert_eq!(get_day_name(&ci, 7), "Sunday");
        assert_eq!(get_day_name(&ci, 8), "Monday");
    }

    // -----------------------------------------------------------------------
    // get_culture tests
    // -----------------------------------------------------------------------

    #[test]
    fn culture_en_us_is_default() {
        let ci = get_culture("en-US");
        let def = CultureInfo::default();
        assert_eq!(ci.decimal_separator, def.decimal_separator);
        assert_eq!(ci.thousands_separator, def.thousands_separator);
        assert_eq!(ci.currency_symbol, def.currency_symbol);
        assert_eq!(ci.date_order(), def.date_order());
        assert!(!ci.use_24_hour());
    }

    #[test]
    fn culture_de_de() {
        let ci = get_culture("de-DE");
        assert_eq!(ci.decimal_separator, ",");
        assert_eq!(ci.thousands_separator, ".");
        assert_eq!(ci.currency_symbol, "\u{20ac}");
        assert_eq!(ci.date_order(), DateOrder::DMY);
        assert!(ci.use_24_hour());
        assert_eq!(get_month_name(&ci, 0), "Januar");
        assert_eq!(get_month_name(&ci, 2), "M\u{00e4}rz");
        assert_eq!(get_day_name(&ci, 1), "Montag");
    }

    #[test]
    fn culture_ja_jp() {
        let ci = get_culture("ja-JP");
        assert_eq!(ci.decimal_separator, ".");
        assert_eq!(ci.currency_symbol, "\u{00a5}");
        assert_eq!(ci.date_order(), DateOrder::YMD);
        assert_eq!(get_am_pm_designator(&ci, 5), "\u{5348}\u{524d}");
        assert_eq!(get_am_pm_designator(&ci, 15), "\u{5348}\u{5f8c}");
    }

    #[test]
    fn culture_fr_fr_nbsp_thousands() {
        let ci = get_culture("fr-FR");
        assert_eq!(ci.thousands_separator, "\u{00A0}");
        assert_eq!(ci.decimal_separator, ",");
    }

    #[test]
    fn culture_unknown_falls_back() {
        let ci = get_culture("xx-XX");
        let def = CultureInfo::default();
        assert_eq!(ci.decimal_separator, def.decimal_separator);
        assert_eq!(ci.currency_symbol, def.currency_symbol);
    }

    #[test]
    fn date_order_derived_from_pattern() {
        assert_eq!(get_culture("en-US").date_order(), DateOrder::MDY);
        assert_eq!(get_culture("de-DE").date_order(), DateOrder::DMY);
        assert_eq!(get_culture("ja-JP").date_order(), DateOrder::YMD);
        assert_eq!(get_culture("ko-KR").date_order(), DateOrder::YMD);
        assert_eq!(get_culture("es-ES").date_order(), DateOrder::DMY);
    }

    #[test]
    fn use_24_hour_derived_from_pattern() {
        assert!(!get_culture("en-US").use_24_hour());
        assert!(get_culture("de-DE").use_24_hour());
        assert!(get_culture("fr-FR").use_24_hour());
        assert!(get_culture("ja-JP").use_24_hour());
        assert!(!get_culture("ko-KR").use_24_hour()); // Korean uses tt (AM/PM)
    }

    #[test]
    fn get_all_cultures_returns_10() {
        let all = get_all_cultures();
        assert_eq!(all.len(), 10);
        assert_eq!(all[0].name, "en-US");
        assert_eq!(all[9].name, "ko-KR");
    }
}
