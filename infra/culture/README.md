# @mog/culture

OS-level culture/locale package. Leaf dependency — any app can import this without pulling in kernel or spreadsheet concepts.

## What's here

- **Registry** — `getCulture()`, `getDefaultCulture()`, `getAllCultures()`, `isCultureSupported()`
- **Normalization** — `normalizeNumber()`, `normalizeNegative()` (locale-aware input cleanup)
- **Detection** — `detectCurrency()`, `detectPercentage()`, `parseFraction()`, `stripCurrency()`, `stripPercentage()`
- **Culture data** — 10 cultures: en-US, en-GB, de-DE, fr-FR, es-ES, it-IT, pt-BR, ja-JP, zh-CN, ko-KR

## Usage

```typescript
import { getCulture, normalizeNumber, detectCurrency } from '@mog/culture';

const culture = getCulture('de-DE');
normalizeNumber('1.234,56', culture); // '1234.56'
detectCurrency('$1,234.56');          // { symbol: '$', code: 'USD', ... }
```

## Culture data: Rust is the source of truth

`cultures.gen.ts` is **auto-generated** from the Rust `CultureInfo` struct in `compute-formats/src/locale.rs`. Do not edit it manually.

### To add a new culture

1. Add a match arm in `compute-core/crates/compute-formats/src/locale.rs` → `get_culture()`
2. Regenerate the TS file:
   ```bash
   cargo test -p bridge-ts --test generate_culture_data -- generate --nocapture
   ```
3. Commit both files

### To verify the generated file is fresh

```bash
cd os && cargo test -p bridge-ts --test generate_culture_data -- verify_up_to_date
```

This test regenerates in memory and asserts it matches the on-disk file. It will fail if someone edits Rust culture data but forgets to regenerate.

## Tests

```bash
pnpm --filter @mog/culture test    # 48 tests across 3 suites
```
