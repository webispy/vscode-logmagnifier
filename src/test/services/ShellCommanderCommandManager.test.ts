import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { ShellCommanderCommandManager } from '../../commands/ShellCommanderCommandManager';
import { ShellCommanderService } from '../../services/ShellCommanderService';
import { MockExtensionContext } from '../utils/Mocks';
import { ShellFolder, ShellCommand } from '../../models/ShellCommander';

// Subclass to mock UI
class TestableCommandManager extends ShellCommanderCommandManager {
    public uiMock = {
        showInputBox: this.createMock<vscode.InputBoxOptions, string | undefined>(),
        showInformationMessage: this.createMock<string, string | undefined>(),
        showErrorMessage: this.createMock<string, string | undefined>(),
        showWarningMessage: this.createMock<string, string | undefined>(),
        showOpenDialog: this.createMock<vscode.OpenDialogOptions, vscode.Uri[] | undefined>(),
        showSaveDialog: this.createMock<vscode.SaveDialogOptions, vscode.Uri | undefined>(),
        createTerminal: this.createMock<vscode.TerminalOptions, vscode.Terminal>(),
        showTextDocument: this.createMock<vscode.TextDocument, vscode.TextEditor>(),
        terminals: [] as vscode.Terminal[]
    };

    constructor(
        context: vscode.ExtensionContext,
        shellService: ShellCommanderService
    ) {
        super(context, shellService);
        // @ts-expect-error overrides protected property
        this._ui = {
            ...this.uiMock
        };
    }

    protected registerCommands() {
        // No-op for testing to avoid "command already exists" errors
    }

    private createMock<TArgs, TResult>() {
        let handler: ((args: TArgs) => Promise<TResult> | TResult) | undefined;
        const mock = (args: TArgs) => {
            if (handler) {
                return handler(args);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return undefined as any;
        };
        mock.setHandler = (fn: (args: TArgs) => Promise<TResult> | TResult) => { handler = fn; };
        return mock;
    }
}

suite('ShellCommanderCommandManager Test Suite', () => {
    let service: ShellCommanderService;
    let manager: TestableCommandManager;
    let mockContext: MockExtensionContext;
    let tempDir: string;
    let configPath: string;

    setup(async () => {
        mockContext = new MockExtensionContext();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-logmagnifier-mgr-test-'));
        configPath = path.join(tempDir, 'logmagnifier_shell_cmds.json'); // Default path usage by manager

        mockContext.globalStorageUri = vscode.Uri.file(tempDir);

        service = new ShellCommanderService(mockContext);
        await service.refresh();
        manager = new TestableCommandManager(mockContext, service);
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('addShellGroup creates group via input box', async () => {
        const groupName = 'UI Group';

        // Mock InputBox to return name
        manager.uiMock.showInputBox.setHandler(() => groupName);

        // Execute command (we need to trigger it via public command or access private method?)
        // The methods are private. We should register command and execute it via vscode.commands?
        // Or cast to any to call private method for unit testing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).addShellGroup();

        const group = service.groups.find(g => g.label === groupName);
        assert.ok(group, 'Group should be created via UI flow');
    });

    test('addShellFolder creates folder via input box', async () => {
        const groupName = 'UI Folder Group';
        await service.createGroup(groupName, configPath);
        const group = service.groups.find(g => g.label === groupName)!;

        // Mock InputBox
        const folderName = 'UI Folder';
        manager.uiMock.showInputBox.setHandler(() => folderName);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).addShellFolder(group);

        // Refresh reference
        const updatedGroup = service.groups.find(g => g.label === groupName)!;
        const folder = updatedGroup.children.find(c => c.label === folderName);
        assert.ok(folder, 'Folder should be created');
    });

    test('addShellCommand creates command via input box', async () => {
        const groupName = 'UI Command Group';
        await service.createGroup(groupName, configPath);
        let group = service.groups.find(g => g.label === groupName)!;
        await service.addFolder(group, 'UI Folder');

        group = service.groups.find(g => g.label === groupName)!;
        const folder = group.children[0] as ShellFolder;

        // Mock InputBox
        const cmdName = 'UI Command';
        manager.uiMock.showInputBox.setHandler(() => cmdName);

        // Mock text document checking (editShellItem calls showTextDocument)
        manager.uiMock.showTextDocument.setHandler(() => ({} as vscode.TextEditor));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).addShellCommand(folder);

        group = service.groups.find(g => g.label === groupName)!;
        const updatedFolder = group.children[0] as ShellFolder;
        const command = updatedFolder.children.find(c => c.label === cmdName);
        assert.ok(command, 'Command should be created');
    });

    test('addShellCommand with group parent auto-creates General folder', async () => {
        const groupName = 'Group Parent Test';
        await service.createGroup(groupName, configPath);
        const group = service.groups.find(g => g.label === groupName)!;

        // Mock InputBox for command label
        const cmdName = 'Auto Cmd';
        manager.uiMock.showInputBox.setHandler(() => cmdName);

        // Mock text document checking
        manager.uiMock.showTextDocument.setHandler(() => ({} as vscode.TextEditor));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).addShellCommand(group);

        const updatedGroup = service.groups.find(g => g.label === groupName)!;
        const folder = updatedGroup.children.find(c => c.label === 'General') as ShellFolder;
        assert.ok(folder, 'General folder should be auto-created');
        const command = folder.children.find(c => c.label === cmdName);
        assert.ok(command, 'Command should be created inside General folder');
    });

    test('handleShellKey with c triggers addShellCommand', async () => {
        const groupName = 'Key Test Group';
        await service.createGroup(groupName, configPath);
        const group = service.groups.find(g => g.label === groupName)!;

        // Mock selection in treeView
        // @ts-expect-error mock private property
        manager.treeView = { selection: [group] };

        // Mock InputBox for command label
        const cmdName = 'Shortcut Cmd';
        manager.uiMock.showInputBox.setHandler(() => cmdName);
        manager.uiMock.showTextDocument.setHandler(() => ({} as vscode.TextEditor));

        // Trigger key
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).handleShellKey('c');

        const updatedGroup = service.groups.find(g => g.label === groupName)!;
        const folder = updatedGroup.children.find(c => c.label === 'General') as ShellFolder;
        assert.ok(folder, 'Shortcut should have triggered folder creation');
        const command = folder.children.find(c => c.label === cmdName);
        assert.ok(command, 'Shortcut should have triggered command creation');
    });

    test('executeShellCommand creates and reuses terminal with interruption', async () => {
        const groupName = 'Exec Group';
        await service.createGroup(groupName, configPath);
        let group = service.groups.find(g => g.label === groupName)!;
        await service.addFolder(group, 'Exec Folder');

        group = service.groups.find(g => g.label === groupName)!;
        const folder = group.children[0] as ShellFolder;
        await service.addCommand(folder, 'Run Me', 'echo run');

        group = service.groups.find(g => g.label === groupName)!;
        const command = (group.children[0] as ShellFolder).children[0] as ShellCommand;

        const sentTexts: string[] = [];
        const mockTerminal = {
            name: 'Mock Terminal',
            show: () => { },
            sendText: (text: string) => {
                sentTexts.push(text);
            },
            exitStatus: undefined
        } as unknown as vscode.Terminal;

        let createdTerminalCount = 0;
        manager.uiMock.createTerminal.setHandler(() => {
            createdTerminalCount++;
            return mockTerminal;
        });

        manager.uiMock.terminals.push(mockTerminal);
        manager.uiMock.showTextDocument.setHandler(() => ({} as vscode.TextEditor));

        // First execution (new terminal)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).executeShellCommand(command);

        assert.strictEqual(createdTerminalCount, 1, 'Should create terminal');
        assert.deepStrictEqual(sentTexts, ['echo run'], 'Should send only command on first run');

        // Second execution (reuse)
        sentTexts.length = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).executeShellCommand(command);

        assert.strictEqual(createdTerminalCount, 1, 'Should NOT create new terminal');
        assert.deepStrictEqual(sentTexts, ['\u0003', 'echo run'], 'Should send Ctrl+C before command on reuse');
    });

    test('executeShellCommand ignores dead terminal and creates new one', async () => {
        const groupName = 'Dead Term Group';
        await service.createGroup(groupName, configPath);
        let group = service.groups.find(g => g.label === groupName)!;
        await service.addFolder(group, 'Folder');
        group = service.groups.find(g => g.label === groupName)!;
        const folder = group.children[0] as ShellFolder;
        await service.addCommand(folder, 'Cmd', 'ls');
        const command = (service.groups.find(g => g.label === groupName)!.children[0] as ShellFolder).children[0] as ShellCommand;

        const deadTerminal = {
            name: 'Dead Terminal',
            show: () => { },
            sendText: () => { },
            exitStatus: { code: 1 } // dead
        } as unknown as vscode.Terminal;

        const healthyTerminal = {
            name: 'Healthy Terminal',
            show: () => { },
            sendText: () => { },
            exitStatus: undefined
        } as unknown as vscode.Terminal;

        manager.uiMock.terminals.push(deadTerminal);
        // Put it in the manager's map to simulate it was being used
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (manager as any).commandTerminals.set(command.id, deadTerminal);

        let createdHealthy = false;
        manager.uiMock.createTerminal.setHandler(() => {
            createdHealthy = true;
            return healthyTerminal;
        });
        manager.uiMock.showTextDocument.setHandler(() => ({} as vscode.TextEditor));

        // Execute
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).executeShellCommand(command);

        assert.ok(createdHealthy, 'Should create new terminal because the old one was dead');
    });
});
