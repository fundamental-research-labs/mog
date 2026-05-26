/**
 * Tests for TestStore (plain Map-backed)
 */

import { TestStore } from '../src/test-store';

describe('TestStore', () => {
  let store: TestStore;

  beforeEach(() => {
    store = new TestStore();
  });

  describe('assertions', () => {
    describe('addAssertion', () => {
      it('should add an assertion and return it with an ID', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        expect(assertion.id).toBeDefined();
        expect(assertion.id).toMatch(/^assert-/);
        expect(assertion.createdAt).toBeDefined();
        expect(assertion.updatedAt).toBeDefined();
      });

      it('should persist the assertion', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        const retrieved = store.getAssertion(assertion.id);
        expect(retrieved).toEqual(assertion);
      });
    });

    describe('updateAssertion', () => {
      it('should update an existing assertion', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        store.updateAssertion(assertion.id, {
          params: { expected: 200 },
          message: 'Updated message',
        });

        const updated = store.getAssertion(assertion.id);
        expect(updated?.params.expected).toBe(200);
        expect(updated?.message).toBe('Updated message');
        expect(updated?.id).toBe(assertion.id); // ID preserved
      });

      it('should update the updatedAt timestamp', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        const originalTimestamp = assertion.updatedAt;

        store.updateAssertion(assertion.id, { enabled: false });

        const updated = store.getAssertion(assertion.id);
        expect(updated?.updatedAt).toBeGreaterThanOrEqual(originalTimestamp!);
      });
    });

    describe('removeAssertion', () => {
      it('should remove an assertion', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        store.removeAssertion(assertion.id);

        const retrieved = store.getAssertion(assertion.id);
        expect(retrieved).toBeUndefined();
      });

      it('should remove assertion from suites when deleted', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        const suite = store.createSuite('Test Suite');
        store.addAssertionsToSuite(suite.id, [assertion.id]);

        // Verify assertion is in suite
        let currentSuite = store.getSuite(suite.id);
        expect(currentSuite?.assertionIds).toContain(assertion.id);

        // Remove assertion
        store.removeAssertion(assertion.id);

        // Verify removed from suite
        currentSuite = store.getSuite(suite.id);
        expect(currentSuite?.assertionIds).not.toContain(assertion.id);
      });
    });

    describe('getAssertionsForCell', () => {
      it('should return assertions targeting a specific cell', () => {
        store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 1 },
          type: 'equals',
          params: { expected: 200 },
          severity: 'error',
          enabled: true,
        });

        const assertions = store.getAssertionsForCell('sheet1', 0, 0);
        expect(assertions).toHaveLength(1);
        expect(assertions[0].params.expected).toBe(100);
      });

      it('should return assertions where cell is in range target', () => {
        store.addAssertion({
          target: {
            type: 'range',
            sheetId: 'sheet1',
            startRow: 0,
            startCol: 0,
            endRow: 5,
            endCol: 5,
          },
          type: 'noError',
          params: {},
          severity: 'error',
          enabled: true,
        });

        const assertions = store.getAssertionsForCell('sheet1', 2, 2);
        expect(assertions).toHaveLength(1);
      });

      it('should not return assertions for cells outside range', () => {
        store.addAssertion({
          target: {
            type: 'range',
            sheetId: 'sheet1',
            startRow: 0,
            startCol: 0,
            endRow: 5,
            endCol: 5,
          },
          type: 'noError',
          params: {},
          severity: 'error',
          enabled: true,
        });

        const assertions = store.getAssertionsForCell('sheet1', 10, 10);
        expect(assertions).toHaveLength(0);
      });
    });

    describe('getAllAssertions', () => {
      it('should return all assertions', () => {
        store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 1, col: 0 },
          type: 'notEmpty',
          params: {},
          severity: 'warning',
          enabled: true,
        });

        const all = store.getAllAssertions();
        expect(all).toHaveLength(2);
      });
    });
  });

  describe('test suites', () => {
    describe('createSuite', () => {
      it('should create a suite with default values', () => {
        const suite = store.createSuite('My Test Suite');

        expect(suite.id).toBeDefined();
        expect(suite.name).toBe('My Test Suite');
        expect(suite.assertionIds).toEqual([]);
        expect(suite.autoRun).toBe(false);
        expect(suite.blockOnFailure).toBe(false);
      });

      it('should create a suite with custom options', () => {
        const suite = store.createSuite('My Test Suite', {
          description: 'Test description',
          autoRun: true,
          blockOnFailure: true,
        });

        expect(suite.description).toBe('Test description');
        expect(suite.autoRun).toBe(true);
        expect(suite.blockOnFailure).toBe(true);
      });
    });

    describe('updateSuite', () => {
      it('should update a suite', () => {
        const suite = store.createSuite('Original Name');

        store.updateSuite(suite.id, {
          name: 'Updated Name',
          autoRun: true,
        });

        const updated = store.getSuite(suite.id);
        expect(updated?.name).toBe('Updated Name');
        expect(updated?.autoRun).toBe(true);
      });
    });

    describe('deleteSuite', () => {
      it('should delete a suite', () => {
        const suite = store.createSuite('Test Suite');
        store.deleteSuite(suite.id);

        const retrieved = store.getSuite(suite.id);
        expect(retrieved).toBeUndefined();
      });
    });

    describe('listSuites', () => {
      it('should return all suites', () => {
        store.createSuite('Suite 1');
        store.createSuite('Suite 2');

        const suites = store.listSuites();
        expect(suites).toHaveLength(2);
      });
    });

    describe('addAssertionsToSuite', () => {
      it('should add assertions to a suite', () => {
        const assertion1 = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        const assertion2 = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 1, col: 0 },
          type: 'notEmpty',
          params: {},
          severity: 'error',
          enabled: true,
        });

        const suite = store.createSuite('Test Suite');
        store.addAssertionsToSuite(suite.id, [assertion1.id, assertion2.id]);

        const updated = store.getSuite(suite.id);
        expect(updated?.assertionIds).toContain(assertion1.id);
        expect(updated?.assertionIds).toContain(assertion2.id);
      });

      it('should not add duplicates', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        const suite = store.createSuite('Test Suite');
        store.addAssertionsToSuite(suite.id, [assertion.id]);
        store.addAssertionsToSuite(suite.id, [assertion.id]);

        const updated = store.getSuite(suite.id);
        expect(updated?.assertionIds).toHaveLength(1);
      });

      it('should filter out non-existent assertions', () => {
        const assertion = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        const suite = store.createSuite('Test Suite');
        store.addAssertionsToSuite(suite.id, [assertion.id, 'non-existent-id']);

        const updated = store.getSuite(suite.id);
        expect(updated?.assertionIds).toHaveLength(1);
        expect(updated?.assertionIds).toContain(assertion.id);
      });
    });

    describe('removeAssertionsFromSuite', () => {
      it('should remove assertions from a suite', () => {
        const assertion1 = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
          type: 'equals',
          params: { expected: 100 },
          severity: 'error',
          enabled: true,
        });

        const assertion2 = store.addAssertion({
          target: { type: 'cell', sheetId: 'sheet1', row: 1, col: 0 },
          type: 'notEmpty',
          params: {},
          severity: 'error',
          enabled: true,
        });

        const suite = store.createSuite('Test Suite');
        store.addAssertionsToSuite(suite.id, [assertion1.id, assertion2.id]);
        store.removeAssertionsFromSuite(suite.id, [assertion1.id]);

        const updated = store.getSuite(suite.id);
        expect(updated?.assertionIds).not.toContain(assertion1.id);
        expect(updated?.assertionIds).toContain(assertion2.id);
      });
    });
  });

  describe('configuration', () => {
    it('should set and get autoRun configuration', () => {
      expect(store.isAutoRunEnabled()).toBe(false);

      store.setAutoRunEnabled(true);
      expect(store.isAutoRunEnabled()).toBe(true);

      store.setAutoRunEnabled(false);
      expect(store.isAutoRunEnabled()).toBe(false);
    });
  });

  describe('observers', () => {
    it('should notify assertion observers on add', () => {
      const callback = jest.fn();
      store.onAssertionsChanged(callback);

      store.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should notify suite observers on create', () => {
      const callback = jest.fn();
      store.onSuitesChanged(callback);

      store.createSuite('Test Suite');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe observers', () => {
      const callback = jest.fn();
      const unsubscribe = store.onAssertionsChanged(callback);

      store.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 100 },
        severity: 'error',
        enabled: true,
      });

      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      store.addAssertion({
        target: { type: 'cell', sheetId: 'sheet1', row: 0, col: 0 },
        type: 'equals',
        params: { expected: 200 },
        severity: 'error',
        enabled: true,
      });

      // Should still be 1 since we unsubscribed
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
