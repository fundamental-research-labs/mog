use super::super::*;

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
    assert_eq!(ci.currency_code, "EUR");
    assert_eq!(ci.date_order(), DateOrder::DMY);
    assert!(ci.use_24_hour());
    assert_eq!(get_month_name(&ci, 0), "Januar");
    assert_eq!(get_month_name(&ci, 2), "M\u{00e4}rz");
    assert_eq!(get_day_name(&ci, 1), "Montag");
    assert_eq!(ci.list_separator, ";");
}

#[test]
fn culture_ja_jp() {
    let ci = get_culture("ja-JP");
    assert_eq!(ci.decimal_separator, ".");
    assert_eq!(ci.currency_symbol, "\u{00a5}");
    assert_eq!(ci.currency_code, "JPY");
    assert_eq!(ci.currency_decimal_digits, 0);
    assert_eq!(ci.date_order(), DateOrder::YMD);
    assert_eq!(get_month_name(&ci, 0), "1\u{6708}");
    assert_eq!(get_day_name(&ci, 0), "\u{65e5}\u{66dc}\u{65e5}");
    assert_eq!(get_am_pm_designator(&ci, 5), "\u{5348}\u{524d}");
    assert_eq!(get_am_pm_designator(&ci, 15), "\u{5348}\u{5f8c}");
}

#[test]
fn culture_fr_fr_nbsp_thousands() {
    let ci = get_culture("fr-FR");
    assert_eq!(ci.thousands_separator, "\u{00A0}");
    assert_eq!(ci.decimal_separator, ",");
    assert_eq!(ci.true_string, "VRAI");
    assert_eq!(ci.false_string, "FAUX");
}

#[test]
fn culture_unknown_falls_back() {
    let ci = get_culture("xx-XX");
    let def = CultureInfo::default();
    assert_eq!(ci.decimal_separator, def.decimal_separator);
    assert_eq!(ci.currency_symbol, def.currency_symbol);
}

#[test]
fn get_all_cultures_returns_10() {
    let all = get_all_cultures();
    assert_eq!(all.len(), 10);
    assert_eq!(
        all.iter().map(|ci| ci.name.as_str()).collect::<Vec<_>>(),
        vec![
            "en-US", "en-GB", "de-DE", "fr-FR", "es-ES", "it-IT", "pt-BR", "ja-JP", "zh-CN",
            "ko-KR",
        ]
    );
}

#[test]
fn supported_culture_parity() {
    let en_gb = get_culture("en-GB");
    assert_eq!(en_gb.currency_code, "GBP");
    assert_eq!(en_gb.first_day_of_week, 1);
    assert_eq!(en_gb.short_date_pattern, "dd/MM/yyyy");
    assert!(en_gb.use_24_hour());

    let es_es = get_culture("es-ES");
    assert_eq!(es_es.shortest_day_names[3], "X");
    assert_eq!(es_es.true_string, "VERDADERO");

    let it_it = get_culture("it-IT");
    assert_eq!(get_month_name(&it_it, 0), "gennaio");
    assert_eq!(get_day_name(&it_it, 1), "luned\u{00ec}");
    assert_eq!(it_it.true_string, "VERO");

    let pt_br = get_culture("pt-BR");
    assert_eq!(pt_br.currency_symbol, "R$");
    assert_eq!(pt_br.currency_code, "BRL");
    assert_eq!(pt_br.first_day_of_week, 0);
    assert_eq!(get_month_name(&pt_br, 2), "mar\u{00e7}o");
    assert_eq!(get_day_name(&pt_br, 2), "ter\u{00e7}a-feira");

    let zh_cn = get_culture("zh-CN");
    assert_eq!(zh_cn.currency_code, "CNY");
    assert_eq!(zh_cn.am_designator, "\u{4e0a}\u{5348}");
    assert_eq!(zh_cn.pm_designator, "\u{4e0b}\u{5348}");
    assert_eq!(get_month_name(&zh_cn, 0), "\u{4e00}\u{6708}");
    assert_eq!(get_day_name(&zh_cn, 1), "\u{661f}\u{671f}\u{4e00}");

    let ko_kr = get_culture("ko-KR");
    assert_eq!(ko_kr.currency_code, "KRW");
    assert_eq!(ko_kr.currency_decimal_digits, 0);
    assert_eq!(ko_kr.short_date_pattern, "yyyy-MM-dd");
    assert_eq!(ko_kr.am_designator, "\u{c624}\u{c804}");
    assert_eq!(ko_kr.pm_designator, "\u{c624}\u{d6c4}");
    assert_eq!(get_month_name(&ko_kr, 0), "1\u{c6d4}");
    assert_eq!(get_day_name(&ko_kr, 1), "\u{c6d4}\u{c694}\u{c77c}");
}
