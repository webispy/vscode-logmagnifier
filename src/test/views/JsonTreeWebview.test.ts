import * as assert from 'assert';
import * as vscode from 'vscode';
import { JsonTreeWebview } from '../../views/JsonTreeWebview';
import { JsonTreeHtmlGenerator } from '../../views/JsonTreeHtmlGenerator';
import { MockExtensionContext } from '../utils/Mocks';

suite('JsonTreeWebview Test Suite', () => {
    let webview: JsonTreeWebview;
    let mockContext: MockExtensionContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let originalGenerate: any;

    setup(() => {
        mockContext = new MockExtensionContext();
        webview = new JsonTreeWebview(mockContext as unknown as vscode.ExtensionContext);

        originalGenerate = JsonTreeHtmlGenerator.prototype.generate;
        JsonTreeHtmlGenerator.prototype.generate = async () => '<html></html>';
    });

    teardown(() => {
        webview.dispose();
        JsonTreeHtmlGenerator.prototype.generate = originalGenerate;
    });

    test('show creates panel', async () => {
        let panelCreated = false;

        const mockPanel = {
            webview: {
                html: '',
                onDidReceiveMessage: () => ({ dispose: () => { } }),
                postMessage: async () => true
            },
            onDidDispose: () => ({ dispose: () => { } }),
            reveal: () => { },
            dispose: () => { }
        } as unknown as vscode.WebviewPanel;

        const originalCreateWebviewPanel = vscode.window.createWebviewPanel;
        vscode.window.createWebviewPanel = () => {
            panelCreated = true;
            return mockPanel;
        };

        await webview.show({ key: 'value' });

        vscode.window.createWebviewPanel = originalCreateWebviewPanel;

        assert.strictEqual(panelCreated, true);
        assert.strictEqual(webview.isVisible, true);
    });

    test('show reuses existing panel and posts message', async () => {
        let postedMessage: { command?: string; data?: unknown } | undefined;
        let revealed = false;

        const mockPanel = {
            webview: {
                html: '',
                onDidReceiveMessage: () => ({ dispose: () => { } }),
                postMessage: async (msg: unknown) => {
                    postedMessage = msg as { command?: string; data?: unknown };
                    return true;
                }
            },
            onDidDispose: () => ({ dispose: () => { } }),
            reveal: () => { revealed = true; },
            dispose: () => { }
        } as unknown as vscode.WebviewPanel;

        const originalCreateWebviewPanel = vscode.window.createWebviewPanel;
        vscode.window.createWebviewPanel = () => mockPanel;

        // First call creates panel
        await webview.show({ key1: 'value1' });
        // Second call reuses it
        await webview.show({ key2: 'value2' });

        vscode.window.createWebviewPanel = originalCreateWebviewPanel;

        assert.strictEqual(revealed, true);
        assert.ok(postedMessage);
        assert.deepStrictEqual(postedMessage.data, { key2: 'value2' });
        assert.strictEqual(postedMessage.command, 'update');
    });

    test('dispose clears panel', async () => {
        const mockPanel = {
            webview: {
                html: '',
                onDidReceiveMessage: () => ({ dispose: () => { } }),
                postMessage: async () => true
            },
            onDidDispose: () => ({ dispose: () => { } }),
            reveal: () => { },
            dispose: () => { }
        } as unknown as vscode.WebviewPanel;

        const originalCreateWebviewPanel = vscode.window.createWebviewPanel;
        vscode.window.createWebviewPanel = () => mockPanel;

        await webview.show({ key: 'value' });
        assert.strictEqual(webview.isVisible, true);

        webview.dispose();
        assert.strictEqual(webview.isVisible, false);

        vscode.window.createWebviewPanel = originalCreateWebviewPanel;
    });
});
