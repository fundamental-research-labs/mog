import { createVersionMutationAdmissionOptions } from '../version-operation-context';
import { CREATED_AT_MS, createBridgeFixture } from './version-operation-context-test-utils';

export function registerVersionOperationContextGroupedIdentityScenarios(): void {
  describe('VersionOperationContext grouped-command identity validation', () => {
    it('rejects grouped contexts whose group id cannot identify an outer command', () => {
      const { ctx, diagnostics } = createBridgeFixture();

      expect(() =>
        createVersionMutationAdmissionOptions(ctx as any, {
          operationIdPrefix: 'workbook.sheets.add.move',
          domainIds: ['sheets'],
          groupId: 'not-a-version-operation-id',
        }),
      ).toThrow(
        "Grouped VersionOperationContext for 'workbook.sheets.add.move' requires groupId to be a VersionOperationContext operationId; received 'not-a-version-operation-id'.",
      );

      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'versioning.admission.missing-context',
          severity: 'error',
          command: 'workbook.sheets.add.move',
          message:
            "Grouped VersionOperationContext for 'workbook.sheets.add.move' requires groupId to be a VersionOperationContext operationId; received 'not-a-version-operation-id'.",
        }),
      ]);
    });

    it('rejects grouped contexts whose command is not nested under the group command', () => {
      const { ctx, diagnostics } = createBridgeFixture();

      expect(() =>
        createVersionMutationAdmissionOptions(ctx as any, {
          operationIdPrefix: 'workbook.sheets.add.move',
          domainIds: ['sheets'],
          groupId: `workbook.sheets.copy:${CREATED_AT_MS}:1`,
        }),
      ).toThrow(
        "Grouped VersionOperationContext for 'workbook.sheets.add.move' is not nested under operation group 'workbook.sheets.copy'.",
      );

      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'versioning.admission.missing-context',
          severity: 'error',
          command: 'workbook.sheets.add.move',
          message:
            "Grouped VersionOperationContext for 'workbook.sheets.add.move' is not nested under operation group 'workbook.sheets.copy'.",
        }),
      ]);
    });

    it('rejects empty command identity before fabricating an operation id', () => {
      const { ctx, diagnostics } = createBridgeFixture();

      expect(() =>
        createVersionMutationAdmissionOptions(ctx as any, {
          operationIdPrefix: '',
          domainIds: ['sheets'],
        }),
      ).toThrow('VersionOperationContext requires a non-empty operationIdPrefix.');

      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'versioning.admission.missing-context',
          severity: 'error',
          command: '<missing-operation-id-prefix>',
          message: 'VersionOperationContext requires a non-empty operationIdPrefix.',
        }),
      ]);
    });
  });
}
