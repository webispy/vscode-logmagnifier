import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { ShellCommanderService } from '../../services/ShellCommanderService';
import { MockExtensionContext } from '../utils/Mocks';
import { ShellFolder, ShellCommand } from '../../models/ShellCommander';

suite('ShellCommanderService Test Suite', () => {
    let service: ShellCommanderService;
    let mockContext: MockExtensionContext;
    let tempDir: string;
    let configPath: string;

    setup(async () => {
        mockContext = new MockExtensionContext();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-logmagnifier-test-'));
        configPath = path.join(tempDir, 'test_shell_cmds.json');

        // Setup global storage URI mock
        mockContext.globalStorageUri = vscode.Uri.file(tempDir);

        service = new ShellCommanderService(mockContext);
        await service.refresh();
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('Initialization creates default config if none exists', async () => {
        // Service should have created default config and loaded it
        const groups = service.groups;
        assert.strictEqual(groups.length, 1);
        assert.strictEqual(groups[0].label, 'android');
    });

    test('createGroup creates a new group and saves to file', async () => {
        const groupName = 'New Test Group';
        await service.createGroup(groupName, configPath);

        const groups = service.groups;
        const newGroup = groups.find(g => g.label === groupName);

        assert.ok(newGroup, 'New group should exist in service');
        assert.strictEqual(newGroup?.configPath, configPath);

        // Verify file content
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        const json = JSON.parse(fileContent);
        assert.strictEqual(json.groups[0].groupName, groupName);
        assert.strictEqual(json.version, 1);
        assert.ok(json.shortCutKeymap, 'Should have shortCutKeymap');
    });

    test('addFolder adds a folder to a group', async () => {
        const groupName = 'Folder Test Group';
        await service.createGroup(groupName, configPath);

        const group = service.groups.find(g => g.label === groupName)!;
        await service.addFolder(group, 'My Folder');

        // Refetch group because addFolder reloads configuration
        const updatedGroup = service.groups.find(g => g.label === groupName)!;
        const folder = updatedGroup.children.find(c => c.label === 'My Folder');
        assert.ok(folder, 'Folder should be added to group');
        assert.strictEqual(folder?.kind, 'folder');
    });

    test('addCommand adds a command to a folder', async () => {
        const groupName = 'Command Test Group';
        await service.createGroup(groupName, configPath);

        let group = service.groups.find(g => g.label === groupName)!;
        await service.addFolder(group, 'My Folder');

        // Refetch group
        group = service.groups.find(g => g.label === groupName)!;
        const folder = group.children.find(c => c.label === 'My Folder') as ShellFolder;

        await service.addCommand(folder, 'My Command', 'echo hello');

        // Refetch group again to verify persistence
        group = service.groups.find(g => g.label === groupName)!;
        const updatedFolder = group.children.find(c => c.label === 'My Folder') as ShellFolder;
        const command = updatedFolder.children.find(c => c.label === 'My Command') as ShellCommand;

        assert.ok(command, 'Command should be added to folder');
        assert.strictEqual(command?.command, 'echo hello');
    });

    test('deleteGroup removes group and updates config', async () => {
        const groupName = 'Delete Test Group';
        await service.createGroup(groupName, configPath);

        const group = service.groups.find(g => g.label === groupName)!;
        await service.deleteGroup(group);

        const deletedGroup = service.groups.find(g => g.label === groupName);
        assert.strictEqual(deletedGroup, undefined, 'Group should be removed');

        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf-8');
            const json = JSON.parse(content);
            assert.strictEqual(json.groups.length, 0);
        }
    });

    test('renameGroup updates group name and file', async () => {
        const oldName = 'Rename Old';
        const newName = 'Rename New';
        await service.createGroup(oldName, configPath);

        const group = service.groups.find(g => g.label === oldName)!;
        await service.renameGroup(group, newName);

        assert.ok(service.groups.find(g => g.label === newName), 'Group should have new name');
        assert.strictEqual(service.groups.find(g => g.label === oldName), undefined, 'Old name should not exist');
    });

    test('updateItem updates command details', async () => {
        const groupName = 'Update Test';
        await service.createGroup(groupName, configPath);
        let group = service.groups.find(g => g.label === groupName)!;

        await service.addFolder(group, 'F1');
        group = service.groups.find(g => g.label === groupName)!;
        const folder = group.children[0] as ShellFolder;

        await service.addCommand(folder, 'C1', 'echo 1');
        group = service.groups.find(g => g.label === groupName)!;
        const command = (group.children[0] as ShellFolder).children[0] as ShellCommand;

        await service.updateItem(command, { label: 'C1 Updated', command: 'echo 2' });

        // Verify in-memory update (updateItem updates the object passing in, AND reloads)
        // Check fresh state
        group = service.groups.find(g => g.label === groupName)!;
        const updatedCommand = (group.children[0] as ShellFolder).children[0] as ShellCommand;

        assert.strictEqual(updatedCommand.label, 'C1 Updated');
        assert.strictEqual(updatedCommand.command, 'echo 2');
    });

    test('importGroup loads existing config', async () => {
        const importPath = path.join(tempDir, 'import.json');
        const config = [{
            groupName: 'Imported Group',
            descript: 'Imported',
            folders: []
        }];
        fs.writeFileSync(importPath, JSON.stringify(config));

        await service.importGroup(importPath);

        const imported = service.groups.find(g => g.label === 'Imported Group');
        assert.ok(imported, 'Imported group should exist');
        assert.strictEqual(imported?.configPath, importPath);
    });

    test('deleteItem removes command from folder', async () => {
        const groupName = 'Delete Item Test';
        await service.createGroup(groupName, configPath);
        let group = service.groups.find(g => g.label === groupName)!;

        await service.addFolder(group, 'F1');
        group = service.groups.find(g => g.label === groupName)!;
        const folder = group.children[0] as ShellFolder;

        await service.addCommand(folder, 'C1', 'echo 1');
        group = service.groups.find(g => g.label === groupName)!;
        const command = (group.children[0] as ShellFolder).children[0] as ShellCommand;

        await service.deleteItem(command);

        group = service.groups.find(g => g.label === groupName)!;
        const updatedFolder = group.children[0] as ShellFolder;
        assert.strictEqual(updatedFolder.children.length, 0);
    });
});
