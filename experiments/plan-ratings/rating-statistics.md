# Rating Statistics

Input dataset: `ratings.csv`

## Overall

| n | Mean | Median | Sample SD | Population SD | Min | Q1 | Q3 | Max |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 400 | 8.008 | 8 | 0.503 | 0.502 | 5 | 8 | 8 | 9 |

## Distribution

| Rating | Count | Percent |
| ---: | ---: | ---: |
| 5 | 1 | 0.2% |
| 6 | 4 | 1.0% |
| 7 | 31 | 7.8% |
| 8 | 319 | 79.8% |
| 9 | 45 | 11.2% |

## By Review Set

| Group | n | Mean | SEM | Median | Sample SD | Min | Q1 | Q3 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude-code-review-of-claude-code-plans | 100 | 8.42 | 0.052 | 8 | 0.516 | 7 | 8 | 9 | 9 |
| claude-code-review-of-codex-plans | 100 | 7.96 | 0.024 | 8 | 0.243 | 7 | 8 | 8 | 9 |
| codex-review-of-claude-code-plans | 100 | 7.66 | 0.061 | 8 | 0.607 | 5 | 7 | 8 | 8 |
| codex-review-of-codex-plans | 100 | 7.99 | 0.017 | 8 | 0.174 | 7 | 8 | 8 | 9 |

## By Reviewer

| Group | n | Mean | SEM | Median | Sample SD | Min | Q1 | Q3 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude-code | 200 | 8.19 | 0.033 | 8 | 0.464 | 7 | 8 | 8 | 9 |
| codex | 200 | 7.825 | 0.034 | 8 | 0.475 | 5 | 8 | 8 | 9 |

## By Reviewed Plan Author

| Group | n | Mean | SEM | Median | Sample SD | Min | Q1 | Q3 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude-code | 200 | 8.04 | 0.048 | 8 | 0.679 | 5 | 8 | 8 | 9 |
| codex | 200 | 7.975 | 0.015 | 8 | 0.211 | 7 | 8 | 8 | 9 |

## Reviewer Plan-Author Preference Tests

Paired two-sided t-tests compare matching plan IDs within each reviewer. Mean difference is `Codex-plan rating - Claude-Code-plan rating`; Holm p-values correct across these two reviewer-specific tests.

| Reviewer | n | Mean diff | SE diff | t | df | Raw p | Holm p | Codex-plan wins | Claude-Code-plan wins | Ties | Significant at 0.05 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| claude-code | 100 | -0.46 | 0.058 | -7.987 | 99 | <0.001 | <0.001 | 2 | 46 | 52 | yes |
| codex | 100 | 0.33 | 0.062 | 5.319 | 99 | <0.001 | <0.001 | 28 | 1 | 71 | yes |

## Paired Plan Author Comparison

| Reviewer | Complete pairs | Mean codex minus claude-code | Median diff | Codex wins | Claude-code wins | Ties |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| claude-code | 100 | -0.46 | 0 | 2 | 46 | 52 |
| codex | 100 | 0.33 | 0 | 28 | 1 | 71 |

## Reviewer Agreement

Complete reviewer pairs: 200
Mean codex-reviewer minus claude-code-reviewer: -0.365
Median absolute reviewer difference: 0
Reviewer agreement within 1 point: 187 / 200
Codex reviewer higher: 6; Claude Code reviewer higher: 65; ties: 129

