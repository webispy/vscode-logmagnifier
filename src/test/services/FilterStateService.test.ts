import * as assert from 'assert';

import { FilterGroup, HighlightMode } from '../../models/Filter';

import { FilterStateService } from '../../services/FilterStateService';
import { Logger } from '../../services/Logger';
import { MockExtensionContext } from '../utils/Mocks';

suite('FilterStateService Test Suite', () => {
    let service: FilterStateService;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        service = new FilterStateService(mockContext, Logger.getInstance());
    });

    test('loadFromState returns empty array when no data saved', () => {
        const result = service.loadFromState();
        assert.deepStrictEqual(result, []);
    });

    test('saveToState and loadFromState round-trip', () => {
        const groups: FilterGroup[] = [
            {
                id: 'g1',
                name: 'Group 1',
                isEnabled: true,
                filters: [
                    { id: 'f1', keyword: 'error', type: 'include', isEnabled: true }
                ]
            }
        ];

        service.saveToState(groups);
        const loaded = service.loadFromState();

        assert.strictEqual(loaded.length, 1);
        assert.strictEqual(loaded[0].name, 'Group 1');
        assert.strictEqual(loaded[0].filters.length, 1);
        assert.strictEqual(loaded[0].filters[0].keyword, 'error');
    });

    test('loadFromState migrates legacy enableFullLineHighlight to highlightMode', () => {
        // Simulate legacy data with enableFullLineHighlight
        interface LegacyFilter {
            id: string;
            keyword: string;
            type: string;
            isEnabled: boolean;
            enableFullLineHighlight?: boolean;
        }
        const legacyGroups = [
            {
                id: 'g1',
                name: 'Legacy Group',
                isEnabled: true,
                filters: [
                    { id: 'f1', keyword: 'warn', type: 'include', isEnabled: true, enableFullLineHighlight: true } as LegacyFilter,
                    { id: 'f2', keyword: 'info', type: 'include', isEnabled: true, enableFullLineHighlight: false } as LegacyFilter,
                    { id: 'f3', keyword: 'debug', type: 'include', isEnabled: true } as LegacyFilter
                ]
            }
        ];

        // Save legacy data directly to globalState
        mockContext.globalState.update('logViewer.filterGroups', legacyGroups);

        // Need to use the correct key - check Constants
        service.saveToState(legacyGroups as unknown as FilterGroup[]);
        const loaded = service.loadFromState();

        assert.strictEqual(loaded[0].filters[0].highlightMode, HighlightMode.Line,
            'enableFullLineHighlight=true should migrate to HighlightMode.Line');
        assert.strictEqual(loaded[0].filters[1].highlightMode, HighlightMode.Word,
            'enableFullLineHighlight=false should migrate to HighlightMode.Word');
    });

    test('deepCopy produces an independent copy', () => {
        const original: FilterGroup = {
            id: 'g1',
            name: 'Original',
            isEnabled: true,
            filters: [{ id: 'f1', keyword: 'test', type: 'include', isEnabled: true }]
        };

        const copy = service.deepCopy(original);

        assert.deepStrictEqual(copy, original);

        // Modify original and verify copy is independent
        original.name = 'Modified';
        original.filters[0].keyword = 'changed';

        assert.strictEqual(copy.name, 'Original');
        assert.strictEqual(copy.filters[0].keyword, 'test');
    });

    test('deepCopy handles empty objects', () => {
        const empty: FilterGroup = {
            id: 'g1',
            name: 'Empty',
            isEnabled: false,
            filters: []
        };
        const copy = service.deepCopy(empty);
        assert.deepStrictEqual(copy, empty);
    });

    test('saveToState overwrites previous state', () => {
        const groups1: FilterGroup[] = [
            { id: 'g1', name: 'First', isEnabled: true, filters: [] }
        ];
        const groups2: FilterGroup[] = [
            { id: 'g2', name: 'Second', isEnabled: true, filters: [] },
            { id: 'g3', name: 'Third', isEnabled: false, filters: [] }
        ];

        service.saveToState(groups1);
        service.saveToState(groups2);

        const loaded = service.loadFromState();
        assert.strictEqual(loaded.length, 2);
        assert.strictEqual(loaded[0].name, 'Second');
        assert.strictEqual(loaded[1].name, 'Third');
    });
});
