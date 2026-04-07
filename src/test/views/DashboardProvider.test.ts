import * as assert from 'assert';
import * as vscode from 'vscode';

import { FilterManager } from '../../services/FilterManager';
import { Logger } from '../../services/Logger';
import { WorkflowManager } from '../../services/WorkflowManager';
import { DashboardProvider } from '../../views/DashboardProvider';
import { MockExtensionContext } from '../utils/Mocks';

suite('DashboardProvider Test Suite', () => {
    let provider: DashboardProvider;
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        const mockWorkflowManager = {
            onDidChangeWorkflow: () => ({ dispose: () => { } })
        } as unknown as WorkflowManager;

        provider = new DashboardProvider(filterManager, mockWorkflowManager, Logger.getInstance());
    });

    teardown(() => {
        provider.dispose();
    });

    test('getTreeItem returns element as-is', () => {
        const item = new vscode.TreeItem('Test', vscode.TreeItemCollapsibleState.None);
        assert.strictEqual(provider.getTreeItem(item), item);
    });

    test('getChildren returns empty array for child elements', async () => {
        const parent = new vscode.TreeItem('Parent');
        const children = await provider.getChildren(parent);
        assert.strictEqual(children.length, 0);
    });

    test('getChildren returns items at root level', async () => {
        const children = await provider.getChildren();
        assert.ok(children.length > 0, 'Should return quick access items');

        // Should contain profile item
        const profileItem = children.find(c => String(c.label).includes('Filter Profile'));
        assert.ok(profileItem, 'Should contain profile item');
    });

    test('getChildren includes toggle items', async () => {
        const children = await provider.getChildren();
        const labels = children.map(c => String(c.label));

        assert.ok(labels.some(l => l.includes('Word Wrap')), 'Should have Word Wrap');
        assert.ok(labels.some(l => l.includes('Minimap')), 'Should have Minimap toggle');
        assert.ok(labels.some(l => l.includes('Sticky Scroll')), 'Should have Sticky Scroll toggle');
        assert.ok(labels.some(l => l.includes('JSON Preview')), 'Should have JSON Preview toggle');
    });

    test('getChildren includes file size item', async () => {
        const children = await provider.getChildren();
        const labels = children.map(c => String(c.label));

        assert.ok(labels.some(l => l.includes('File Size')), 'Should have File Size item');
    });

    test('getChildren includes separator', async () => {
        const children = await provider.getChildren();
        const separator = children.find(c => c.contextValue === 'separator');
        assert.ok(separator, 'Should contain a separator');
    });

    test('refresh fires onDidChangeTreeData', () => {
        let eventFired = false;
        provider.onDidChangeTreeData(() => { eventFired = true; });
        provider.refresh();
        assert.ok(eventFired);
    });

    test('toggleFileSizeUnit cycles through units', async () => {
        // Start at 'bytes', cycle through
        await provider.toggleFileSizeUnit();
        // After toggle, should have refreshed (no crash)

        await provider.toggleFileSizeUnit();
        await provider.toggleFileSizeUnit();
        // Should cycle back to bytes without error
    });

    test('profile item shows active profile name', async () => {
        const children = await provider.getChildren();
        const profileItem = children.find(c => String(c.label).includes('Filter Profile'));
        assert.ok(profileItem);

        const activeProfile = filterManager.getActiveProfile();
        assert.ok(String(profileItem.label).includes(activeProfile));
    });

    test('toggle items have commands', async () => {
        const children = await provider.getChildren();
        const toggleItems = children.filter(c =>
            String(c.label).includes(': On') || String(c.label).includes(': Off')
        );

        for (const item of toggleItems) {
            assert.ok(item.command, `Toggle item "${item.label}" should have a command`);
        }
    });

    test('dispose does not throw', () => {
        assert.doesNotThrow(() => provider.dispose());
    });
});
