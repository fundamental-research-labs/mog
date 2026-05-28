/// Currency symbol definition (symbol glyph, human name, ISO 4217 code).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencySymbolDef {
    /// The currency symbol glyph (e.g., "$", "\u{20AC}").
    pub symbol: &'static str,
    /// Human-readable name (e.g., "US Dollar").
    pub name: &'static str,
    /// ISO 4217 currency code (e.g., "USD").
    pub code: &'static str,
}

/// All supported currency symbols (26 currencies).
pub static CURRENCY_SYMBOLS: [CurrencySymbolDef; 26] = [
    CurrencySymbolDef {
        symbol: "$",
        name: "US Dollar",
        code: "USD",
    },
    CurrencySymbolDef {
        symbol: "\u{20ac}",
        name: "Euro",
        code: "EUR",
    },
    CurrencySymbolDef {
        symbol: "\u{00a3}",
        name: "British Pound",
        code: "GBP",
    },
    CurrencySymbolDef {
        symbol: "\u{00a5}",
        name: "Japanese Yen",
        code: "JPY",
    },
    CurrencySymbolDef {
        symbol: "\u{00a5}",
        name: "Chinese Yuan",
        code: "CNY",
    },
    CurrencySymbolDef {
        symbol: "\u{20b9}",
        name: "Indian Rupee",
        code: "INR",
    },
    CurrencySymbolDef {
        symbol: "\u{20a9}",
        name: "Korean Won",
        code: "KRW",
    },
    CurrencySymbolDef {
        symbol: "CHF",
        name: "Swiss Franc",
        code: "CHF",
    },
    CurrencySymbolDef {
        symbol: "CA$",
        name: "Canadian Dollar",
        code: "CAD",
    },
    CurrencySymbolDef {
        symbol: "A$",
        name: "Australian Dollar",
        code: "AUD",
    },
    CurrencySymbolDef {
        symbol: "R$",
        name: "Brazilian Real",
        code: "BRL",
    },
    CurrencySymbolDef {
        symbol: "\u{20bd}",
        name: "Russian Ruble",
        code: "RUB",
    },
    CurrencySymbolDef {
        symbol: "kr",
        name: "Swedish Krona",
        code: "SEK",
    },
    CurrencySymbolDef {
        symbol: "kr",
        name: "Norwegian Krone",
        code: "NOK",
    },
    CurrencySymbolDef {
        symbol: "kr",
        name: "Danish Krone",
        code: "DKK",
    },
    CurrencySymbolDef {
        symbol: "z\u{0142}",
        name: "Polish Zloty",
        code: "PLN",
    },
    CurrencySymbolDef {
        symbol: "\u{20ba}",
        name: "Turkish Lira",
        code: "TRY",
    },
    CurrencySymbolDef {
        symbol: "\u{0e3f}",
        name: "Thai Baht",
        code: "THB",
    },
    CurrencySymbolDef {
        symbol: "S$",
        name: "Singapore Dollar",
        code: "SGD",
    },
    CurrencySymbolDef {
        symbol: "HK$",
        name: "Hong Kong Dollar",
        code: "HKD",
    },
    CurrencySymbolDef {
        symbol: "NT$",
        name: "Taiwan Dollar",
        code: "TWD",
    },
    CurrencySymbolDef {
        symbol: "\u{20b1}",
        name: "Philippine Peso",
        code: "PHP",
    },
    CurrencySymbolDef {
        symbol: "R",
        name: "South African Rand",
        code: "ZAR",
    },
    CurrencySymbolDef {
        symbol: "Mex$",
        name: "Mexican Peso",
        code: "MXN",
    },
    CurrencySymbolDef {
        symbol: "AED",
        name: "UAE Dirham",
        code: "AED",
    },
    CurrencySymbolDef {
        symbol: "SAR",
        name: "Saudi Riyal",
        code: "SAR",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currency_symbols_has_26_entries() {
        assert_eq!(CURRENCY_SYMBOLS.len(), 26);
    }

    #[test]
    fn currency_usd_is_first() {
        assert_eq!(CURRENCY_SYMBOLS[0].symbol, "$");
        assert_eq!(CURRENCY_SYMBOLS[0].code, "USD");
    }

    #[test]
    fn currency_eur_is_second() {
        assert_eq!(CURRENCY_SYMBOLS[1].symbol, "\u{20ac}");
        assert_eq!(CURRENCY_SYMBOLS[1].code, "EUR");
    }

    #[test]
    fn duplicate_currency_symbols_keep_distinct_codes() {
        assert_eq!(CURRENCY_SYMBOLS[3].symbol, "\u{00a5}");
        assert_eq!(CURRENCY_SYMBOLS[3].code, "JPY");
        assert_eq!(CURRENCY_SYMBOLS[4].symbol, "\u{00a5}");
        assert_eq!(CURRENCY_SYMBOLS[4].code, "CNY");
        assert_eq!(CURRENCY_SYMBOLS[12].symbol, "kr");
        assert_eq!(CURRENCY_SYMBOLS[12].code, "SEK");
        assert_eq!(CURRENCY_SYMBOLS[13].symbol, "kr");
        assert_eq!(CURRENCY_SYMBOLS[13].code, "NOK");
        assert_eq!(CURRENCY_SYMBOLS[14].symbol, "kr");
        assert_eq!(CURRENCY_SYMBOLS[14].code, "DKK");
    }

    #[test]
    fn currency_sar_is_last() {
        assert_eq!(CURRENCY_SYMBOLS[25].code, "SAR");
    }
}
