export type RefName = string & {
  readonly __brand: 'RefName';
};

export type RefNamePrefix = string & {
  readonly __brand: 'RefNamePrefix';
};

export type RefNameValidationIssue =
  | 'notString'
  | 'empty'
  | 'tooLong'
  | 'nonAscii'
  | 'containsPercent'
  | 'containsWhitespace'
  | 'containsControl'
  | 'containsUppercase'
  | 'reservedDetached'
  | 'reservedMainPrefix'
  | 'reservedRefsPrefix'
  | 'reservedSystemRef'
  | 'leadingSlash'
  | 'trailingSlash'
  | 'emptySegment'
  | 'containsDotDot'
  | 'lockSegment'
  | 'segmentEndsWithLock'
  | 'invalidFormat';

export interface RefNameDiagnostic {
  readonly code: `refName.${RefNameValidationIssue}`;
  readonly issue: RefNameValidationIssue;
  readonly severity: 'error';
  readonly message: string;
  readonly value?: string;
  readonly byteLength?: number;
  readonly maxByteLength?: number;
}

export type RefNameValidationResult =
  | { readonly ok: true; readonly name: RefName; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly RefNameDiagnostic[] };

export type RefNamePrefixValidationResult =
  | { readonly ok: true; readonly prefix: RefNamePrefix; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly RefNameDiagnostic[] };

export const REF_NAME_MAX_BYTES = 128;
export const REF_NAME_STORAGE_PREFIX = 'refs/heads/';

export const REF_NAME_PATTERN =
  /^(main|[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*)$/;

const UPPER_HEX = '0123456789ABCDEF';

export class RefNameValidationError extends Error {
  readonly diagnostics: readonly RefNameDiagnostic[];

  constructor(value: unknown, diagnostics: readonly RefNameDiagnostic[]) {
    super(`Invalid RefName: ${formatRefNameValue(value)}.`);
    this.name = 'RefNameValidationError';
    this.diagnostics = diagnostics;
  }
}

export function parseRefName(value: unknown, paramName = 'refName'): RefName {
  const result = validateRefName(value, paramName);
  if (!result.ok) {
    throw new RefNameValidationError(value, result.diagnostics);
  }
  return result.name;
}

export function isRefName(value: unknown): value is RefName {
  return validateRefName(value).ok;
}

export function validateRefName(value: unknown, paramName = 'refName'): RefNameValidationResult {
  if (typeof value !== 'string') {
    return {
      ok: false,
      diagnostics: [diagnostic('notString', `${paramName} must be a string RefName.`, undefined)],
    };
  }

  const diagnostics: RefNameDiagnostic[] = [];
  const byteLength = utf8ByteLength(value);

  if (value.length === 0) {
    diagnostics.push(diagnostic('empty', `${paramName} must not be empty.`, value));
  }

  if (byteLength > REF_NAME_MAX_BYTES) {
    diagnostics.push(
      diagnostic(
        'tooLong',
        `${paramName} must be at most ${REF_NAME_MAX_BYTES} UTF-8 bytes.`,
        value,
        byteLength,
      ),
    );
  }

  if (value === 'detached') {
    diagnostics.push(diagnostic('reservedDetached', `${paramName} "detached" is reserved.`, value));
  }

  if (value.startsWith('main/')) {
    diagnostics.push(
      diagnostic('reservedMainPrefix', `${paramName} must not start with main/.`, value),
    );
  }

  if (value === 'refs' || value.startsWith('refs/')) {
    diagnostics.push(
      diagnostic('reservedRefsPrefix', `${paramName} under refs/* is reserved.`, value),
    );
  }

  if (value === 'refs/system' || value.startsWith('refs/system/')) {
    diagnostics.push(
      diagnostic('reservedSystemRef', `${paramName} under refs/system/* is reserved.`, value),
    );
  }

  collectCharacterDiagnostics(value, paramName, diagnostics);
  collectPathDiagnostics(value, paramName, diagnostics);

  if (!REF_NAME_PATTERN.test(value)) {
    diagnostics.push(
      diagnostic('invalidFormat', `${paramName} must match ${REF_NAME_PATTERN.source}.`, value),
    );
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return { ok: true, name: value as RefName, diagnostics: [] };
}

export function validateRefNamePrefix(
  value: unknown,
  paramName = 'refPrefix',
): RefNamePrefixValidationResult {
  if (typeof value !== 'string') {
    return {
      ok: false,
      diagnostics: [
        diagnostic('notString', `${paramName} must be a string RefName prefix.`, undefined),
      ],
    };
  }

  if (value.length === 0) {
    return {
      ok: false,
      diagnostics: [diagnostic('empty', `${paramName} must not be empty.`, value)],
    };
  }

  if (value.startsWith('main/')) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('reservedMainPrefix', `${paramName} must not start with main/.`, value),
      ],
    };
  }

  const validationTarget = value.endsWith('/') ? value.slice(0, -1) : value;
  const parsed = validateRefName(validationTarget, paramName);
  if (!parsed.ok) return parsed;
  return { ok: true, prefix: value as RefNamePrefix, diagnostics: [] };
}

export function encodeRefNameForStorage(name: RefName): string {
  return encodeKeyComponent(parseRefName(name));
}

export function refNameStorageKey(name: RefName | string): string {
  return `${REF_NAME_STORAGE_PREFIX}${encodeRefNameForStorage(parseRefName(name))}`;
}

export function encodeKeyComponent(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = '';

  for (const byte of bytes) {
    if (byte === 0x2f || byte === 0x25 || byte >= 0x80) {
      encoded += `%${UPPER_HEX[byte >> 4]}${UPPER_HEX[byte & 0x0f]}`;
    } else {
      encoded += String.fromCharCode(byte);
    }
  }

  return encoded;
}

function collectCharacterDiagnostics(
  value: string,
  paramName: string,
  diagnostics: RefNameDiagnostic[],
): void {
  let hasNonAscii = false;
  let hasPercent = false;
  let hasWhitespace = false;
  let hasControl = false;
  let hasUppercase = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const code = value.charCodeAt(i);

    if (code > 0x7f) {
      hasNonAscii = true;
    }
    if (char === '%') {
      hasPercent = true;
    }
    if (code <= 0x1f || code === 0x7f) {
      hasControl = true;
    }
    if (/\s/.test(char)) {
      hasWhitespace = true;
    }
    if (char >= 'A' && char <= 'Z') {
      hasUppercase = true;
    }
  }

  if (hasNonAscii) {
    diagnostics.push(diagnostic('nonAscii', `${paramName} must contain ASCII only.`, value));
  }
  if (hasPercent) {
    diagnostics.push(diagnostic('containsPercent', `${paramName} must not contain %.`, value));
  }
  if (hasWhitespace) {
    diagnostics.push(
      diagnostic('containsWhitespace', `${paramName} must not contain whitespace.`, value),
    );
  }
  if (hasControl) {
    diagnostics.push(
      diagnostic('containsControl', `${paramName} must not contain control characters.`, value),
    );
  }
  if (hasUppercase) {
    diagnostics.push(
      diagnostic('containsUppercase', `${paramName} must use lowercase ASCII.`, value),
    );
  }
}

function collectPathDiagnostics(
  value: string,
  paramName: string,
  diagnostics: RefNameDiagnostic[],
): void {
  if (value.startsWith('/')) {
    diagnostics.push(diagnostic('leadingSlash', `${paramName} must not start with /.`, value));
  }
  if (value.endsWith('/')) {
    diagnostics.push(diagnostic('trailingSlash', `${paramName} must not end with /.`, value));
  }
  if (value.includes('//')) {
    diagnostics.push(
      diagnostic('emptySegment', `${paramName} must not contain empty path segments.`, value),
    );
  }
  if (value.includes('..')) {
    diagnostics.push(diagnostic('containsDotDot', `${paramName} must not contain ...`, value));
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '.lock')) {
    diagnostics.push(
      diagnostic('lockSegment', `${paramName} must not contain a .lock segment.`, value),
    );
  }
  if (segments.some((segment) => segment.length > 0 && segment.endsWith('.lock'))) {
    diagnostics.push(
      diagnostic('segmentEndsWithLock', `${paramName} segments must not end with .lock.`, value),
    );
  }
}

function diagnostic(
  issue: RefNameValidationIssue,
  message: string,
  value: string | undefined,
  byteLength?: number,
): RefNameDiagnostic {
  return Object.freeze({
    code: `refName.${issue}`,
    issue,
    severity: 'error',
    message,
    value,
    byteLength,
    maxByteLength: issue === 'tooLong' ? REF_NAME_MAX_BYTES : undefined,
  });
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatRefNameValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}
