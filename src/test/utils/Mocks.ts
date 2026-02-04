import * as vscode from 'vscode';

// Mock Memento for GlobalState
export class MockMemento implements vscode.Memento {
    private storage = new Map<string, any>();

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get(key: string, defaultValue?: any): any {
        return this.storage.has(key) ? this.storage.get(key) : defaultValue;
    }

    update(key: string, value: any): Thenable<void> {
        this.storage.set(key, value);
        return Promise.resolve();
    }

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }

    setKeysForSync(keys: readonly string[]): void {
        // No-op
    }
}

// Mock ExtensionContext
export class MockExtensionContext implements vscode.ExtensionContext {
    globalState: vscode.Memento & { setKeysForSync(keys: readonly string[]): void } = new MockMemento();
    subscriptions: { dispose(): any }[] = [];
    workspaceState: vscode.Memento = new MockMemento();
    extensionPath: string = '/mock/path';
    storagePath: string | undefined = '/mock/storage';
    globalStoragePath: string = '/mock/globalStorage';
    logPath: string = '/mock/log';
    asAbsolutePath(relativePath: string): string {
        return `/mock/path/${relativePath}`;
    }
    storageUri: vscode.Uri | undefined = undefined;
    globalStorageUri: vscode.Uri = vscode.Uri.file('/mock/globalStorage');
    logUri: vscode.Uri = vscode.Uri.file('/mock/log');
    extensionUri: vscode.Uri = vscode.Uri.file('/mock/path');
    environmentVariableCollection: any;
    extension: any = {
        packageJSON: {
            version: '0.0.0-test'
        }
    };
    extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Test;

    // Missing properties from newer VS Code API, added as any to satisfy TS if needed
    secrets: any;
    languageModelAccessInformation: any;
}
