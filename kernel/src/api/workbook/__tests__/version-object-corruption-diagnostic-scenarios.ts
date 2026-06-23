import {
  recoverabilityForVersionObjectRead,
  versionObjectReadDiagnosticCode,
} from '../version-object-read-diagnostics';
import { RAW_OBJECT_PREIMAGE_CANARY } from './version-object-corruption-test-utils';

export function registerVersionObjectCorruptionDiagnosticScenarios(): void {
  it('classifies malformed object read refs as stable repair diagnostics', () => {
    expect(
      versionObjectReadDiagnosticCode({
        diagnostic: {
          dependency: {
            kind: 'object',
            objectType: 'workbook.mergePreview.v1',
          },
        },
      }),
    ).toBe('VERSION_INVALID_DIGEST');
    expect(recoverabilityForVersionObjectRead('VERSION_INVALID_DIGEST', 'retry')).toBe('repair');

    expect(
      versionObjectReadDiagnosticCode({
        details: {
          objectKind: 'commit',
          digest: 'redacted',
        },
      }),
    ).toBe('VERSION_INVALID_DEPENDENCY');
    expect(recoverabilityForVersionObjectRead('VERSION_INVALID_DEPENDENCY', 'retry')).toBe(
      'repair',
    );
  });

  it('classifies malformed JSON and payload diagnostics without exposing raw text', () => {
    expect(versionObjectReadDiagnosticCode(new SyntaxError(RAW_OBJECT_PREIMAGE_CANARY))).toBe(
      'VERSION_INVALID_PAYLOAD',
    );
    expect(versionObjectReadDiagnosticCode({ code: 'VERSION_MALFORMED_JSON' })).toBe(
      'VERSION_INVALID_PAYLOAD',
    );
    expect(recoverabilityForVersionObjectRead('VERSION_INVALID_PAYLOAD', 'retry')).toBe('repair');
  });

  it('classifies unavailable provider object reads as stable retry diagnostics', () => {
    const diagnostic = {
      safeMessage: RAW_OBJECT_PREIMAGE_CANARY,
      details: {
        sourceCode: 'VERSION_PROVIDER_FAILED',
        providerRefId: RAW_OBJECT_PREIMAGE_CANARY,
      },
    };

    expect(versionObjectReadDiagnosticCode(diagnostic)).toBe('VERSION_PROVIDER_FAILED');
    expect(recoverabilityForVersionObjectRead(diagnostic, 'repair')).toBe('retry');
    expect(versionObjectReadDiagnosticCode({ code: RAW_OBJECT_PREIMAGE_CANARY })).toBe(
      'VERSION_PROVIDER_FAILED',
    );
  });
}
