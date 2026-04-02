import * as assert from 'assert';
import { isFilterGroup, FilterGroup, FilterItem, HighlightMode } from '../../models/Filter';

suite('Filter Model Test Suite', () => {
    suite('isFilterGroup', () => {
        test('returns true for a valid FilterGroup', () => {
            const group: FilterGroup = {
                id: 'g1',
                name: 'Test Group',
                filters: [],
                isEnabled: true
            };
            assert.strictEqual(isFilterGroup(group), true);
        });

        test('returns true for a FilterGroup with filters', () => {
            const group: FilterGroup = {
                id: 'g1',
                name: 'Test',
                filters: [{ id: 'f1', keyword: 'test', type: 'include', isEnabled: true }],
                isEnabled: true
            };
            assert.strictEqual(isFilterGroup(group), true);
        });

        test('returns false for a FilterItem', () => {
            const item: FilterItem = {
                id: 'f1',
                keyword: 'test',
                type: 'include',
                isEnabled: true
            };
            assert.strictEqual(isFilterGroup(item), false);
        });

        test('returns false for null', () => {
            assert.strictEqual(isFilterGroup(null), false);
        });

        test('returns false for undefined', () => {
            assert.strictEqual(isFilterGroup(undefined), false);
        });

        test('returns false for primitive values', () => {
            assert.strictEqual(isFilterGroup('string'), false);
            assert.strictEqual(isFilterGroup(42), false);
            assert.strictEqual(isFilterGroup(true), false);
        });

        test('returns false for object without filters property', () => {
            assert.strictEqual(isFilterGroup({ id: 'g1', name: 'Test' }), false);
        });

        test('returns false when filters is not an array', () => {
            assert.strictEqual(isFilterGroup({ filters: 'not-array' }), false);
            assert.strictEqual(isFilterGroup({ filters: {} }), false);
        });
    });

    suite('HighlightMode enum', () => {
        test('has expected values', () => {
            assert.strictEqual(HighlightMode.Word, 0);
            assert.strictEqual(HighlightMode.Line, 1);
            assert.strictEqual(HighlightMode.FullLine, 2);
        });
    });
});
