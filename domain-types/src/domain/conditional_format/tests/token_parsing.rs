use super::*;

#[test]
fn cf_operator_from_ooxml_token_accepts_all_known_tokens() {
    let cases = [
        ("greaterThan", CFOperator::GreaterThan),
        ("lessThan", CFOperator::LessThan),
        ("greaterThanOrEqual", CFOperator::GreaterThanOrEqual),
        ("lessThanOrEqual", CFOperator::LessThanOrEqual),
        ("equal", CFOperator::Equal),
        ("notEqual", CFOperator::NotEqual),
        ("between", CFOperator::Between),
        ("notBetween", CFOperator::NotBetween),
    ];
    for (token, expected) in cases {
        assert_eq!(
            CFOperator::from_ooxml_token(token),
            Some(expected),
            "token {token} should parse"
        );
    }
}

#[test]
fn cf_operator_from_ooxml_token_rejects_malformed() {
    assert_eq!(CFOperator::from_ooxml_token(""), None);
    assert_eq!(CFOperator::from_ooxml_token("GreaterThan"), None); // wrong case
    assert_eq!(CFOperator::from_ooxml_token("nope"), None);
    assert_eq!(CFOperator::from_ooxml_token("greaterThan "), None); // trailing space
    assert_eq!(CFOperator::from_ooxml_token("ΕΛΛΗΝΙΚΑ"), None); // non-ASCII
}

#[test]
fn cf_text_operator_from_ooxml_token_accepts_all_known_tokens() {
    let cases = [
        ("contains", CFTextOperator::Contains),
        ("notContains", CFTextOperator::NotContains),
        ("beginsWith", CFTextOperator::BeginsWith),
        ("endsWith", CFTextOperator::EndsWith),
    ];
    for (token, expected) in cases {
        assert_eq!(
            CFTextOperator::from_ooxml_token(token),
            Some(expected),
            "token {token} should parse"
        );
    }
}

#[test]
fn cf_text_operator_from_ooxml_token_rejects_malformed() {
    assert_eq!(CFTextOperator::from_ooxml_token(""), None);
    assert_eq!(CFTextOperator::from_ooxml_token("Contains"), None);
    assert_eq!(CFTextOperator::from_ooxml_token("nope"), None);
}

#[test]
fn date_period_from_ooxml_token_accepts_all_known_tokens() {
    let cases = [
        ("yesterday", DatePeriod::Yesterday),
        ("today", DatePeriod::Today),
        ("tomorrow", DatePeriod::Tomorrow),
        ("last7Days", DatePeriod::Last7Days),
        ("lastWeek", DatePeriod::LastWeek),
        ("thisWeek", DatePeriod::ThisWeek),
        ("nextWeek", DatePeriod::NextWeek),
        ("lastMonth", DatePeriod::LastMonth),
        ("thisMonth", DatePeriod::ThisMonth),
        ("nextMonth", DatePeriod::NextMonth),
        ("lastQuarter", DatePeriod::LastQuarter),
        ("thisQuarter", DatePeriod::ThisQuarter),
        ("nextQuarter", DatePeriod::NextQuarter),
        ("lastYear", DatePeriod::LastYear),
        ("thisYear", DatePeriod::ThisYear),
        ("nextYear", DatePeriod::NextYear),
    ];
    for (token, expected) in cases {
        assert_eq!(
            DatePeriod::from_ooxml_token(token),
            Some(expected),
            "token {token} should parse"
        );
    }
}

#[test]
fn date_period_from_ooxml_token_rejects_malformed() {
    assert_eq!(DatePeriod::from_ooxml_token(""), None);
    assert_eq!(DatePeriod::from_ooxml_token("Today"), None);
    assert_eq!(DatePeriod::from_ooxml_token("last7days"), None); // wrong case
    assert_eq!(DatePeriod::from_ooxml_token("nope"), None);
}
