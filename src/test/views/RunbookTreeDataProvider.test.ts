import * as assert from 'assert';
import * as vscode from 'vscode';
import { RunbookTreeDataProvider } from '../../views/RunbookTreeDataProvider';
import { RunbookService } from '../../services/RunbookService';
import { RunbookGroup, RunbookItem, RunbookMarkdown } from '../../models/Runbook';
import { Constants } from '../../Constants';

suite('RunbookTreeDataProvider Test Suite', () => {
    let provider: RunbookTreeDataProvider;
    let mockService: RunbookService;
    let mockItems: RunbookItem[];
    let changeHandler: (() => void) | undefined;

    const createMarkdown = (label: string, filePath: string): RunbookMarkdown => ({
        id: filePath, kind: 'markdown', label, filePath
    });

    const createGroup = (label: string, dirPath: string, children: RunbookItem[] = []): RunbookGroup => ({
        id: dirPath, kind: 'group', label, dirPath, children
    });

    setup(() => {
        mockItems = [];
        changeHandler = undefined;

        mockService = {
            get items() { return mockItems; },
            onDidChangeTreeData: (handler: () => void) => {
                changeHandler = handler;
                return { dispose: () => { changeHandler = undefined; } };
            },
        } as unknown as RunbookService;

        provider = new RunbookTreeDataProvider(mockService);
    });

    teardown(() => {
        provider.dispose();
    });

    suite('getChildren', () => {
        test('Should return service items when no element is provided', () => {
            const markdown = createMarkdown('test', '/path/test.md');
            const group = createGroup('group', '/path/group');
            mockItems = [group, markdown];

            const children = provider.getChildren() as RunbookItem[];
            assert.strictEqual(children.length, 2);
            assert.strictEqual(children, mockItems, 'should return the same reference as service.items');
        });

        test('Should return children for a group element', () => {
            const child = createMarkdown('child', '/path/group/child.md');
            const group = createGroup('group', '/path/group', [child]);

            const children = provider.getChildren(group) as RunbookItem[];
            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0].label, 'child');
        });

        test('Should return empty array for a markdown element', () => {
            const markdown = createMarkdown('test', '/path/test.md');
            const children = provider.getChildren(markdown) as RunbookItem[];
            assert.strictEqual(children.length, 0);
        });
    });

    suite('getTreeItem', () => {
        test('Should return correct TreeItem for markdown', () => {
            const markdown = createMarkdown('test', '/path/test.md');

            const treeItem = provider.getTreeItem(markdown);
            assert.strictEqual(treeItem.label, 'test');
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
            assert.strictEqual(treeItem.contextValue, 'runbookMarkdown');
            assert.strictEqual(treeItem.tooltip, '/path/test.md');
            // Icon
            assert.ok(treeItem.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual((treeItem.iconPath as vscode.ThemeIcon).id, 'terminal');
            // Command
            assert.ok(treeItem.command, 'markdown item should have a command');
            assert.strictEqual(treeItem.command!.command, Constants.Commands.RunbookOpenWebview);
        });

        test('Should return correct TreeItem for group', () => {
            const child = createMarkdown('child', '/path/group/child.md');
            const group = createGroup('mygroup', '/path/group', [child]);

            const treeItem = provider.getTreeItem(group);
            assert.strictEqual(treeItem.label, 'mygroup');
            assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(treeItem.contextValue, 'runbookGroup');
            assert.strictEqual(treeItem.tooltip, '/path/group');
            assert.ok(treeItem.iconPath instanceof vscode.Uri);
            assert.strictEqual(treeItem.description, '1 items');
        });
    });

    suite('getParent', () => {
        test('Should return parent group for a markdown item', () => {
            const child = createMarkdown('child', '/path/group/child.md');
            const group = createGroup('group', '/path/group', [child]);
            mockItems = [group];

            const parent = provider.getParent(child);
            assert.strictEqual(parent, group, 'should return the parent group');
        });

        test('Should return undefined for a group item', () => {
            const group = createGroup('group', '/path/group');
            mockItems = [group];

            const parent = provider.getParent(group);
            assert.strictEqual(parent, undefined, 'groups at root should have no parent');
        });
    });

    suite('Event Handling', () => {
        test('Should propagate onDidChangeTreeData from service', () => {
            let providerEventFired = false;
            provider.onDidChangeTreeData(() => { providerEventFired = true; });

            assert.ok(changeHandler, 'change handler should be registered');
            changeHandler!();

            assert.ok(providerEventFired, 'provider should propagate change event');
        });
    });
});
