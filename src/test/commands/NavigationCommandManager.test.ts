import * as assert from 'assert';
import * as vscode from 'vscode';
import { NavigationCommandManager } from '../../commands/NavigationCommandManager';
import { FileHierarchyService } from '../../services/FileHierarchyService';
import { MockExtensionContext } from '../utils/Mocks';
import { Constants } from '../../Constants';

suite('NavigationCommandManager Test Suite', () => {
    let mockContext: MockExtensionContext;
    let mockHierarchyService: FileHierarchyService;
    let registeredCommands: Map<string, (...args: unknown[]) => unknown>;
    let originalRegisterCommand: typeof vscode.commands.registerCommand;

    setup(() => {
        mockContext = new MockExtensionContext();
        registeredCommands = new Map();

        originalRegisterCommand = vscode.commands.registerCommand;
        vscode.commands.registerCommand = (command: string, callback: (...args: unknown[]) => unknown) => {
            registeredCommands.set(command, callback);
            return { dispose: () => { } };
        };

        mockHierarchyService = {
            getRoot: () => undefined,
            getNode: () => undefined,
            getChildren: () => [],
            unregister: () => { }
        } as unknown as FileHierarchyService;

        new NavigationCommandManager(mockContext as unknown as vscode.ExtensionContext, mockHierarchyService);
        vscode.commands.registerCommand = originalRegisterCommand;
    });

    teardown(() => {
        vscode.commands.registerCommand = originalRegisterCommand;
    });

    test('HierarchyOpenParent executes openFile', async () => {
        let openedUri: vscode.Uri | undefined;

        const originalOpenTextDocument = vscode.workspace.openTextDocument;
        const originalShowTextDocument = vscode.window.showTextDocument;

        vscode.workspace.openTextDocument = (async (uri: unknown) => {
            openedUri = uri as vscode.Uri;
            return {} as vscode.TextDocument;
        }) as unknown as typeof vscode.workspace.openTextDocument;
        vscode.window.showTextDocument = async () => ({} as vscode.TextEditor);

        const openCmd = registeredCommands.get(Constants.Commands.HierarchyOpenParent);
        assert.ok(openCmd);

        const testUri = vscode.Uri.file('/test.txt');
        await openCmd(testUri);

        vscode.workspace.openTextDocument = originalOpenTextDocument;
        vscode.window.showTextDocument = originalShowTextDocument;

        assert.strictEqual(openedUri?.fsPath, testUri.fsPath);
    });

    test('HierarchyShowFullTree shows quick pick', async () => {
        let quickPickShown = false;
        const originalCreateQuickPick = vscode.window.createQuickPick;

        vscode.window.createQuickPick = (<T extends vscode.QuickPickItem>() => {
            quickPickShown = true;
            return {
                items: [] as T[],
                show: () => { },
                onDidTriggerItemButton: () => ({ dispose: () => { } }),
                onDidAccept: () => ({ dispose: () => { } }),
                onDidHide: () => ({ dispose: () => { } }),
                dispose: () => { }
            } as unknown as vscode.QuickPick<T>;
        }) as unknown as typeof vscode.window.createQuickPick;

        const originalActiveTextEditorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
        Object.defineProperty(vscode.window, 'activeTextEditor', {
            get: () => ({ document: { uri: vscode.Uri.file('/test.txt') } }),
            configurable: true
        });

        const treeCmd = registeredCommands.get(Constants.Commands.HierarchyShowFullTree);
        assert.ok(treeCmd);
        await treeCmd();

        vscode.window.createQuickPick = originalCreateQuickPick;
        if (originalActiveTextEditorDescriptor) {
            Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditorDescriptor);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (vscode.window as any).activeTextEditor;
        }

        assert.strictEqual(quickPickShown, true);
    });
});
