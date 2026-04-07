import * as assert from 'assert';

import { FilterGroup, FilterItem, HighlightMode } from '../../models/Filter';

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
                    { id: 'f1', pattern: 'error', type: 'include', isEnabled: true }
                ]
            }
        ];

        service.saveToState(groups);
        const loaded = service.loadFromState();

        assert.strictEqual(loaded.length, 1);
        assert.strictEqual(loaded[0].name, 'Group 1');
        assert.strictEqual(loaded[0].filters.length, 1);
        assert.strictEqual(loaded[0].filters[0].pattern, 'error');
    });

    test('loadFromState migrates legacy enableFullLineHighlight to highlightMode', () => {
        // Simulate legacy data with enableFullLineHighlight
        interface LegacyFilter {
            id: string;
            pattern: string;
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
                    { id: 'f1', pattern: 'warn', type: 'include', isEnabled: true, enableFullLineHighlight: true } as LegacyFilter,
                    { id: 'f2', pattern: 'info', type: 'include', isEnabled: true, enableFullLineHighlight: false } as LegacyFilter,
                    { id: 'f3', pattern: 'debug', type: 'include', isEnabled: true } as LegacyFilter
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
            filters: [{ id: 'f1', pattern: 'test', type: 'include', isEnabled: true }]
        };

        const copy = service.deepCopy(original);

        assert.deepStrictEqual(copy, original);

        // Modify original and verify copy is independent
        original.name = 'Modified';
        original.filters[0].pattern = 'changed';

        assert.strictEqual(copy.name, 'Original');
        assert.strictEqual(copy.filters[0].pattern, 'test');
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

    test('loadFromState migrates legacy keyword field to pattern', () => {
        const legacyGroups = [
            {
                id: 'g1', name: 'Group', isEnabled: true,
                filters: [{ id: 'f1', keyword: 'search_term', type: 'include', isEnabled: true }]
            }
        ];
        service.saveToState(legacyGroups as unknown as FilterGroup[]);
        const loaded = service.loadFromState();
        assert.strictEqual(loaded[0].filters[0].pattern, 'search_term');
        assert.strictEqual((loaded[0].filters[0] as unknown as Record<string, unknown>).keyword, undefined);
    });

    test('loadFromState migrates legacy contextLine to contextLines', () => {
        const legacyGroups = [
            {
                id: 'g1', name: 'Group', isEnabled: true,
                filters: [{ id: 'f1', pattern: 'test', type: 'include', isEnabled: true, contextLine: 5 }]
            }
        ];
        service.saveToState(legacyGroups as unknown as FilterGroup[]);
        const loaded = service.loadFromState();
        assert.strictEqual(loaded[0].filters[0].contextLines, 5);
        assert.strictEqual((loaded[0].filters[0] as unknown as Record<string, unknown>).contextLine, undefined);
    });

    test('loadFromState migrates legacy line-through to strikethrough', () => {
        const legacyGroups = [
            {
                id: 'g1', name: 'Group', isEnabled: true,
                filters: [{ id: 'f1', pattern: 'test', type: 'exclude', isEnabled: true, excludeStyle: 'line-through' }]
            }
        ];
        service.saveToState(legacyGroups as unknown as FilterGroup[]);
        const loaded = service.loadFromState();
        assert.strictEqual(loaded[0].filters[0].excludeStyle, 'strikethrough');
    });

    suite('isLegacyVersion', () => {
        test('undefined version is legacy', () => {
            assert.ok(FilterStateService.isLegacyVersion(undefined));
        });

        test('versions before 1.7.1 are legacy', () => {
            assert.ok(FilterStateService.isLegacyVersion('1.7.0'));
            assert.ok(FilterStateService.isLegacyVersion('1.6.5'));
            assert.ok(FilterStateService.isLegacyVersion('0.9.0'));
        });

        test('version 1.7.1 and above are not legacy', () => {
            assert.ok(!FilterStateService.isLegacyVersion('1.7.1'));
            assert.ok(!FilterStateService.isLegacyVersion('1.7.2'));
            assert.ok(!FilterStateService.isLegacyVersion('1.8.0'));
            assert.ok(!FilterStateService.isLegacyVersion('2.0.0'));
        });
    });

    suite('sanitizeImportedFilter', () => {
        test('migrates legacy keyword field to pattern', () => {
            const result = service.sanitizeImportedFilter({ keyword: 'search_term', type: 'include', isEnabled: true });
            assert.strictEqual(result.pattern, 'search_term');
        });

        test('prefers pattern over keyword when both present', () => {
            const result = service.sanitizeImportedFilter({ pattern: 'new_term', keyword: 'old_term', type: 'include', isEnabled: true });
            assert.strictEqual(result.pattern, 'new_term');
        });

        test('migrates legacy contextLine to contextLines', () => {
            const result = service.sanitizeImportedFilter({ pattern: 'test', contextLine: 5 });
            assert.strictEqual(result.contextLines, 5);
        });

        test('prefers contextLines over contextLine when both present', () => {
            const result = service.sanitizeImportedFilter({ pattern: 'test', contextLines: 3, contextLine: 5 });
            assert.strictEqual(result.contextLines, 3);
        });

        test('migrates line-through to strikethrough', () => {
            const result = service.sanitizeImportedFilter({ pattern: 'test', excludeStyle: 'line-through' });
            assert.strictEqual(result.excludeStyle, 'strikethrough');
        });

        test('keeps strikethrough as-is', () => {
            const result = service.sanitizeImportedFilter({ pattern: 'test', excludeStyle: 'strikethrough' });
            assert.strictEqual(result.excludeStyle, 'strikethrough');
        });

        test('disables invalid regex patterns', () => {
            const result = service.sanitizeImportedFilter({ pattern: '[invalid', isRegex: true, isEnabled: true });
            assert.strictEqual(result.isEnabled, false);
        });

        test('assigns new UUID id', () => {
            const result = service.sanitizeImportedFilter({ id: 'old-id', pattern: 'test' });
            assert.notStrictEqual(result.id, 'old-id');
            assert.ok(result.id.length > 0);
        });
    });

    suite('sanitizeFilterGroups', () => {
        test('sanitizes all filters within groups (creates new IDs)', () => {
            const groups: FilterGroup[] = [
                {
                    id: 'g1', name: 'Group', isEnabled: true,
                    filters: [
                        { id: 'f1', keyword: 'old_keyword', type: 'include', isEnabled: true, contextLine: 3, excludeStyle: 'line-through' } as unknown as FilterItem
                    ]
                }
            ];
            service.sanitizeFilterGroups(groups);

            assert.strictEqual(groups[0].filters[0].pattern, 'old_keyword');
            assert.strictEqual(groups[0].filters[0].contextLines, 3);
            assert.strictEqual(groups[0].filters[0].excludeStyle, 'strikethrough');
            assert.notStrictEqual(groups[0].filters[0].id, 'f1', 'sanitizeFilterGroups should create new IDs');
        });
    });

    suite('migrateFilterGroups', () => {
        test('migrates legacy fields in-place preserving IDs', () => {
            const groups: FilterGroup[] = [
                {
                    id: 'g1', name: 'Group', isEnabled: true,
                    filters: [
                        { id: 'f1', keyword: 'old_keyword', type: 'include', isEnabled: true, contextLine: 3, excludeStyle: 'line-through' } as unknown as FilterItem
                    ]
                }
            ];
            service.migrateFilterGroups(groups);

            assert.strictEqual(groups[0].filters[0].pattern, 'old_keyword');
            assert.strictEqual(groups[0].filters[0].contextLines, 3);
            assert.strictEqual(groups[0].filters[0].excludeStyle, 'strikethrough');
            assert.strictEqual(groups[0].filters[0].id, 'f1', 'migrateFilterGroups should preserve existing IDs');
        });
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
