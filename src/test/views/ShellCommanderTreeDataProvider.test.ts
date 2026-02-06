import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { ShellCommanderTreeDataProvider } from '../../views/ShellCommanderTreeDataProvider';
import { ShellCommanderService } from '../../services/ShellCommanderService';
import { MockExtensionContext } from '../utils/Mocks';
import { ShellGroup, ShellFolder, ShellCommand } from '../../models/ShellCommander';

suite('ShellCommanderTreeDataProvider Test Suite', () => {
    let service: ShellCommanderService;
    let provider: ShellCommanderTreeDataProvider;
    let mockContext: MockExtensionContext;
    let tempDir: string;
    let configPath: string;

    setup(async () => {
        mockContext = new MockExtensionContext();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-logmagnifier-tree-test-'));
        configPath = path.join(tempDir, 'shell_tree_test.json');

        mockContext.globalStorageUri = vscode.Uri.file(tempDir);

        service = new ShellCommanderService(mockContext);
        provider = new ShellCommanderTreeDataProvider(service);

        // Setup initial data
        await service.createGroup('Tree Group', configPath);
        const group = service.groups.find(g => g.label === 'Tree Group')!;
        await service.addFolder(group, 'Tree Folder');

        const updatedGroup = service.groups.find(g => g.label === 'Tree Group')!;
        const folder = updatedGroup.children[0] as ShellFolder;
        await service.addCommand(folder, 'Tree Command', 'echo tree');
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('getChildren returns groups for root', async () => {
        const children = await provider.getChildren();
        assert.ok(Array.isArray(children));
        assert.ok(children.length >= 1);
        const group = children.find(c => c.label === 'Tree Group');
        assert.ok(group, 'Tree Group should exist');
    });

    test('getChildren returns folder for group', async () => {
        const groups = (await provider.getChildren()) as ShellGroup[];
        const group = groups.find(g => g.label === 'Tree Group')!;

        const children = await provider.getChildren(group);
        assert.strictEqual(children?.length, 1);
        assert.strictEqual(children![0].label, 'Tree Folder');
    });

    test('getChildren returns command for folder', async () => {
        const groups = (await provider.getChildren()) as ShellGroup[];
        const group = groups.find(g => g.label === 'Tree Group')!;
        const folder = (await provider.getChildren(group))![0] as ShellFolder;

        const children = await provider.getChildren(folder);
        assert.strictEqual(children?.length, 1);
        assert.strictEqual(children![0].label, 'Tree Command');
    });

    test('getTreeItem returns correct item for Group', async () => {
        const groups = (await provider.getChildren()) as ShellGroup[];
        const group = groups.find(g => g.label === 'Tree Group')!;
        const item = provider.getTreeItem(group);

        assert.strictEqual(item.label, 'Tree Group');
        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.strictEqual(item.contextValue, 'shellGroup');
    });

    test('getTreeItem returns correct item for Folder', async () => {
        const groups = (await provider.getChildren()) as ShellGroup[];
        const group = groups.find(g => g.label === 'Tree Group')!;
        const folder = (await provider.getChildren(group))![0] as ShellFolder;
        const item = provider.getTreeItem(folder);

        assert.strictEqual(item.label, 'Tree Folder');
        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.strictEqual(item.contextValue, 'shellFolder');
    });

    test('getTreeItem returns correct item for Command', async () => {
        const groups = (await provider.getChildren()) as ShellGroup[];
        const group = groups.find(g => g.label === 'Tree Group')!;
        const folder = (await provider.getChildren(group))![0] as ShellFolder;
        const command = (await provider.getChildren(folder))![0] as ShellCommand;

        const item = provider.getTreeItem(command);

        assert.strictEqual(item.label, 'Tree Command');
        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        assert.strictEqual(item.contextValue, 'shellCommand');
        assert.strictEqual(item.command?.title, 'Execute Command');
    });

    test('getParent returns correct parent', async () => {
        const groups = (await provider.getChildren()) as ShellGroup[];
        const group = groups.find(g => g.label === 'Tree Group')!;
        const folder = (await provider.getChildren(group))![0] as ShellFolder;
        const command = (await provider.getChildren(folder))![0] as ShellCommand;

        const folderParent = provider.getParent(folder);
        assert.strictEqual((folderParent as ShellGroup).label, group.label);

        const commandParent = provider.getParent(command);
        assert.strictEqual((commandParent as ShellFolder).label, folder.label);
    });
});
