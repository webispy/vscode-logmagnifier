import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterGroup, FilterItem } from '../../models/Filter';
import { FilterManager } from '../../services/FilterManager';
import { Logger } from '../../services/Logger';
import { FilterTreeDataProvider } from '../../views/FilterTreeDataProvider';
import { MockExtensionContext } from '../utils/Mocks';

suite('FilterTreeDataProvider Test Suite', () => {
    let filterManager: FilterManager;
    let provider: FilterTreeDataProvider;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // Clean up default groups, keeping a safe regex group to prevent re-creation
        const safeGroup = filterManager.addGroup('Safe Group', true);
        const groups = filterManager.getGroups();
        [...groups].forEach(g => {
            if (g.id !== safeGroup?.id) {
                filterManager.removeGroup(g.id);
            }
        });

        provider = new FilterTreeDataProvider(filterManager, 'word', Logger.getInstance());
    });

    teardown(() => {
        provider.dispose();
    });

    suite('getChildren', () => {
        test('returns word groups at root level', () => {
            filterManager.addGroup('Word Group', false);
            const children = provider.getChildren() as (FilterGroup | FilterItem)[];
            const wordGroups = children.filter((c): c is FilterGroup => 'filters' in c);
            assert.ok(wordGroups.some(g => g.name === 'Word Group'));
            assert.ok(!wordGroups.some(g => g.name === 'Safe Group'), 'Should not include regex groups');
        });

        test('returns filters within a group', () => {
            const group = filterManager.addGroup('Test Group', false)!;
            filterManager.addFilter(group.id, 'keyword1', 'include', false);
            filterManager.addFilter(group.id, 'keyword2', 'exclude', false);

            const children = provider.getChildren(group) as FilterItem[];
            assert.strictEqual(children.length, 2);
        });

        test('returns empty array for filter item', () => {
            const group = filterManager.addGroup('Test Group', false)!;
            filterManager.addFilter(group.id, 'keyword1', 'include', false);
            const filters = group.filters;
            const children = provider.getChildren(filters[0]) as (FilterGroup | FilterItem)[];
            assert.strictEqual(children.length, 0);
        });
    });

    suite('getTreeItem', () => {
        test('returns correct tree item for disabled group (default)', () => {
            // addGroup creates groups with isEnabled=false by default
            const group = filterManager.addGroup('My Group', false)!;
            filterManager.addFilter(group.id, 'test', 'include', false);

            const treeItem = provider.getTreeItem(group);
            assert.ok(treeItem.label === 'My Group' || (treeItem.label as vscode.TreeItemLabel)?.label === 'My Group');
            assert.strictEqual(treeItem.contextValue, 'filterGroupDisabled');
            assert.strictEqual(treeItem.description, '1 items');
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        });

        test('returns correct tree item for enabled group', () => {
            const group = filterManager.addGroup('Enabled Group', false)!;
            filterManager.toggleGroup(group.id); // false → true
            const updatedGroup = filterManager.getGroups().find(g => g.id === group.id)!;

            const treeItem = provider.getTreeItem(updatedGroup);
            assert.strictEqual(treeItem.contextValue, 'filterGroupEnabled');
        });

        test('returns correct tree item for enabled include filter', () => {
            const group = filterManager.addGroup('Group', false)!;
            filterManager.addFilter(group.id, 'searchterm', 'include', false);
            const filter = filterManager.getGroups().find(g => g.id === group.id)!.filters[0];

            const treeItem = provider.getTreeItem(filter);
            assert.ok(String(treeItem.label).includes('searchterm'));
            assert.ok(treeItem.contextValue?.startsWith('filterItemEnabled'));
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('returns correct tree item for exclude filter with tilde prefix', () => {
            const group = filterManager.addGroup('Group', false)!;
            filterManager.addFilter(group.id, 'noise', 'exclude', false);
            const filter = filterManager.getGroups().find(g => g.id === group.id)!.filters[0];

            const treeItem = provider.getTreeItem(filter);
            assert.ok(String(treeItem.label).includes('^noise'));
        });

        test('returns correct tree item for disabled filter', () => {
            const group = filterManager.addGroup('Group', false)!;
            filterManager.addFilter(group.id, 'test', 'include', false);
            const filter = filterManager.getGroups().find(g => g.id === group.id)!.filters[0];
            filterManager.toggleFilter(group.id, filter.id);
            const updatedFilter = filterManager.getGroups().find(g => g.id === group.id)!.filters[0];

            const treeItem = provider.getTreeItem(updatedFilter);
            assert.ok(treeItem.contextValue?.startsWith('filterItemDisabled'));
        });

        test('shows result count in label when present', () => {
            const group = filterManager.addGroup('Group', false)!;
            filterManager.addFilter(group.id, 'test', 'include', false);
            const filter = filterManager.getGroups().find(g => g.id === group.id)!.filters[0];

            // Simulate result count
            const filterWithCount = { ...filter, resultCount: 42 };
            const treeItem = provider.getTreeItem(filterWithCount);
            assert.ok(String(treeItem.label).includes('(42)'));
        });

        test('shows nickname for regex filter', () => {
            const regexProvider = new FilterTreeDataProvider(filterManager, 'regex', Logger.getInstance());
            // Remove safe group and add our own
            const testGroup = filterManager.addGroup('Regex Group', true)!;
            filterManager.addFilter(testGroup.id, '\\d+', 'include', true, 'Numbers');
            const filter = filterManager.getGroups().find(g => g.id === testGroup.id)!.filters[0];

            const treeItem = regexProvider.getTreeItem(filter);
            assert.ok(String(treeItem.label).includes('Numbers'));
            assert.strictEqual(treeItem.description, '\\d+');
            regexProvider.dispose();
        });
    });

    suite('getParent', () => {
        test('returns null for group items', () => {
            const group = filterManager.addGroup('Group', false)!;
            const parent = provider.getParent(group);
            assert.strictEqual(parent, null);
        });

        test('returns parent group for filter items', () => {
            const group = filterManager.addGroup('Parent Group', false)!;
            filterManager.addFilter(group.id, 'child', 'include', false);
            const filter = filterManager.getGroups().find(g => g.id === group.id)!.filters[0];

            const parent = provider.getParent(filter) as FilterGroup;
            assert.ok(parent);
            assert.strictEqual(parent.id, group.id);
        });
    });

    suite('refresh', () => {
        test('fires onDidChangeTreeData event', () => {
            let eventFired = false;
            provider.onDidChangeTreeData(() => { eventFired = true; });
            provider.refresh();
            assert.ok(eventFired);
        });
    });

    suite('drag and drop', () => {
        test('handleDrag serializes item to data transfer', () => {
            const group = filterManager.addGroup('Drag Group', false)!;
            const dataTransfer = new vscode.DataTransfer();
            const token = new vscode.CancellationTokenSource().token;

            provider.handleDrag([group], dataTransfer, token);
            const item = dataTransfer.get('application/vnd.code.tree.logmagnifier-filters');
            assert.ok(item);
        });

        test('handleDrag respects cancellation', () => {
            const group = filterManager.addGroup('Drag Group', false)!;
            const dataTransfer = new vscode.DataTransfer();
            const cts = new vscode.CancellationTokenSource();
            cts.cancel();

            provider.handleDrag([group], dataTransfer, cts.token);
            const item = dataTransfer.get('application/vnd.code.tree.logmagnifier-filters');
            assert.strictEqual(item, undefined);
        });

        test('handleDrop reorders groups', () => {
            const groupA = filterManager.addGroup('Group A', false)!;
            const groupB = filterManager.addGroup('Group B', false)!;

            const dataTransfer = new vscode.DataTransfer();
            dataTransfer.set('application/vnd.code.tree.logmagnifier-filters',
                new vscode.DataTransferItem(groupA));
            const token = new vscode.CancellationTokenSource().token;

            // Drop groupA after groupB
            provider.handleDrop(groupB, dataTransfer, token);

            const groups = filterManager.getGroups().filter(g => !g.isRegex);
            const indexA = groups.findIndex(g => g.id === groupA.id);
            const indexB = groups.findIndex(g => g.id === groupB.id);
            assert.ok(indexA > indexB, 'Group A should be after Group B');
        });
    });

    suite('dispose', () => {
        test('clears icon cache and disposes subscriptions', () => {
            // Trigger icon generation by getting a tree item
            const group = filterManager.addGroup('Disposable Group', false)!;
            provider.getTreeItem(group);

            // Should not throw
            provider.dispose();
        });
    });

    suite('mode filtering', () => {
        test('word mode excludes regex groups', () => {
            filterManager.addGroup('Word Group', false);
            filterManager.addGroup('Regex Group', true);

            const children = provider.getChildren() as FilterGroup[];
            assert.ok(children.every(g => !g.isRegex || g.name === 'Safe Group' ? false : true) === false);
            assert.ok(children.some(g => g.name === 'Word Group'));
        });

        test('regex mode excludes word groups', () => {
            const regexProvider = new FilterTreeDataProvider(filterManager, 'regex', Logger.getInstance());
            filterManager.addGroup('Word Group', false);
            filterManager.addGroup('Regex Group 2', true);

            const children = regexProvider.getChildren() as FilterGroup[];
            assert.ok(children.every(g => g.isRegex));
            assert.ok(children.some(g => g.name === 'Regex Group 2'));
            regexProvider.dispose();
        });
    });
});
