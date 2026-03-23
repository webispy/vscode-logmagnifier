import * as assert from 'assert';

import { FilterManager } from '../../services/FilterManager';
import { ResultCountService } from '../../services/ResultCountService';
import { MockExtensionContext } from '../utils/Mocks';

suite('ResultCountService Test Suite', () => {
    let filterManager: FilterManager;
    let resultCountService: ResultCountService;

    setup(() => {
        const mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Add a safe regex group to prevent default re-creation
        const safeGroup = filterManager.addGroup('Safe Group', true);
        const groups = filterManager.getGroups();
        [...groups].forEach(g => {
            if (g.id !== safeGroup?.id) {
                filterManager.removeGroup(g.id);
            }
        });

        resultCountService = new ResultCountService(filterManager);
    });

    test('updateCounts sets filter and group counts', () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter1 = filterManager.addFilter(group.id, 'error', 'include', false);
        const filter2 = filterManager.addFilter(group.id, 'warn', 'include', false);

        assert.ok(filter1, 'filter1 should be created');
        assert.ok(filter2, 'filter2 should be created');

        const counts = new Map<string, number>();
        counts.set(filter1.id, 10);
        counts.set(filter2.id, 5);

        resultCountService.updateCounts(counts);

        const updatedGroup = filterManager.getGroups().find(g => g.id === group.id);
        assert.ok(updatedGroup);
        assert.strictEqual(updatedGroup.resultCount, 15, 'Group count should be sum of filter counts');

        const updatedFilter1 = updatedGroup.filters.find(f => f.id === filter1.id);
        const updatedFilter2 = updatedGroup.filters.find(f => f.id === filter2.id);
        assert.strictEqual(updatedFilter1?.resultCount, 10);
        assert.strictEqual(updatedFilter2?.resultCount, 5);
    });

    test('updateCounts defaults to zero for unknown filter ids', () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false);
        assert.ok(filter);

        // Pass an empty map — no known counts
        resultCountService.updateCounts(new Map());

        const updatedGroup = filterManager.getGroups().find(g => g.id === group.id);
        assert.ok(updatedGroup);
        assert.strictEqual(updatedGroup.resultCount, 0);

        const updatedFilter = updatedGroup.filters.find(f => f.id === filter.id);
        assert.strictEqual(updatedFilter?.resultCount, 0);
    });

    test('clearCounts resets all counts to zero', () => {
        const group = filterManager.addGroup('Test Group', false)!;
        const filter = filterManager.addFilter(group.id, 'error', 'include', false);
        assert.ok(filter);

        // First set some counts
        const counts = new Map<string, number>();
        counts.set(filter.id, 42);
        resultCountService.updateCounts(counts);

        // Verify counts are set
        let updatedFilter = filterManager.getGroups()
            .find(g => g.id === group.id)?.filters
            .find(f => f.id === filter.id);
        assert.strictEqual(updatedFilter?.resultCount, 42);

        // Now clear
        resultCountService.clearCounts();

        updatedFilter = filterManager.getGroups()
            .find(g => g.id === group.id)?.filters
            .find(f => f.id === filter.id);
        assert.strictEqual(updatedFilter?.resultCount, 0);

        const updatedGroup = filterManager.getGroups().find(g => g.id === group.id);
        assert.strictEqual(updatedGroup?.resultCount, 0);
    });

    test('updateCounts handles multiple groups', () => {
        const group1 = filterManager.addGroup('Group A', false)!;
        const group2 = filterManager.addGroup('Group B', false)!;
        const f1 = filterManager.addFilter(group1.id, 'error', 'include', false);
        const f2 = filterManager.addFilter(group2.id, 'warn', 'include', false);

        assert.ok(f1);
        assert.ok(f2);

        const counts = new Map<string, number>();
        counts.set(f1.id, 7);
        counts.set(f2.id, 3);

        resultCountService.updateCounts(counts);

        const g1 = filterManager.getGroups().find(g => g.id === group1.id);
        const g2 = filterManager.getGroups().find(g => g.id === group2.id);
        assert.strictEqual(g1?.resultCount, 7);
        assert.strictEqual(g2?.resultCount, 3);
    });
});
