import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { ShellCommanderCommandManager } from '../../services/ShellCommanderCommandManager';
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

    setup(() => {
        mockContext = new MockExtensionContext();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-logmagnifier-mgr-test-'));
        configPath = path.join(tempDir, 'logmagnifier_shell_cmds.json'); // Default path usage by manager

        mockContext.globalStorageUri = vscode.Uri.file(tempDir);

        service = new ShellCommanderService(mockContext);
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

    test('executeShellCommand creates and reuses terminal', async () => {
        const groupName = 'Exec Group';
        await service.createGroup(groupName, configPath);
        let group = service.groups.find(g => g.label === groupName)!;
        await service.addFolder(group, 'Exec Folder');

        group = service.groups.find(g => g.label === groupName)!;
        const folder = group.children[0] as ShellFolder;
        await service.addCommand(folder, 'Run Me', 'echo run');

        group = service.groups.find(g => g.label === groupName)!;
        const command = (group.children[0] as ShellFolder).children[0] as ShellCommand;

        // Mock Terminal
        const mockTerminal = {
            name: 'Mock Terminal',
            show: () => { },
            sendText: (text: string) => {
                assert.strictEqual(text, 'echo run');
            }
        } as unknown as vscode.Terminal;

        let createdTerminal = false;
        manager.uiMock.createTerminal.setHandler(() => {
            createdTerminal = true;
            return mockTerminal;
        });

        manager.uiMock.terminals.push(mockTerminal);

        // Ensure we bypass "Open Editor" by mocking workspace?
        // executeShellCommand tries to find active editor.
        // It calls openCommandEditor -> showTextDocument.
        manager.uiMock.showTextDocument.setHandler(() => ({} as vscode.TextEditor));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).executeShellCommand(command);

        assert.ok(createdTerminal, 'Should create terminal');

        // Test Reuse
        createdTerminal = false; // Reset flag
        // uiMock.createTerminal shouldn't be called if reuse works?
        // But manager logic checks its own map `commandTerminals`.

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (manager as any).executeShellCommand(command);
        assert.strictEqual(createdTerminal, false, 'Should reuse terminal');
    });
});
