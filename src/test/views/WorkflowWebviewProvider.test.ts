import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowWebviewProvider } from '../../views/WorkflowWebviewProvider';
import { WorkflowManager } from '../../services/WorkflowManager';
import { WorkflowHtmlGenerator } from '../../views/WorkflowHtmlGenerator';
import { MockExtensionContext } from '../utils/Mocks';

suite('WorkflowWebviewProvider Test Suite', () => {
    let provider: WorkflowWebviewProvider;
    let mockContext: MockExtensionContext;
    let mockWorkflowManager: WorkflowManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let originalGenerate: any;

    setup(() => {
        mockContext = new MockExtensionContext();
        mockWorkflowManager = {
            getWorkflowViewModels: async () => [],
            getActiveWorkflow: () => undefined,
            getActiveStep: () => undefined,
            onDidChangeWorkflow: () => ({ dispose: () => { } })
        } as unknown as WorkflowManager;

        provider = new WorkflowWebviewProvider(
            mockContext as unknown as vscode.ExtensionContext,
            mockWorkflowManager
        );

        originalGenerate = WorkflowHtmlGenerator.prototype.generate;
        WorkflowHtmlGenerator.prototype.generate = async () => '<html></html>';
    });

    teardown(() => {
        WorkflowHtmlGenerator.prototype.generate = originalGenerate;
    });

    test('resolveWebviewView sets up webview', async () => {
        let listenerRegistered = false;
        let htmlSet = false;

        const mockWebviewView = {
            webview: {
                options: {},
                onDidReceiveMessage: (_listener: unknown) => {
                    listenerRegistered = true;
                },
                set html(_value: string) {
                    htmlSet = true;
                }
            },
            onDidChangeVisibility: () => ({ dispose: () => { } }),
            onDidDispose: () => ({ dispose: () => { } })
        } as unknown as vscode.WebviewView;

        await provider.resolveWebviewView(
            mockWebviewView,
            {} as vscode.WebviewViewResolveContext,
            {} as vscode.CancellationToken
        );

        assert.strictEqual(listenerRegistered, true, 'Message listener should be registered');
        assert.strictEqual(htmlSet, true, 'HTML should be set');
    });

    test('refresh posts update message', async () => {
        let postedMessage: { type?: string } | undefined;
        const mockWebviewView = {
            webview: {
                options: {},
                onDidReceiveMessage: () => { },
                html: '',
                postMessage: async (msg: unknown) => {
                    postedMessage = msg as { type?: string };
                }
            },
            onDidChangeVisibility: () => ({ dispose: () => { } }),
            onDidDispose: () => ({ dispose: () => { } })
        } as unknown as vscode.WebviewView;

        await provider.resolveWebviewView(
            mockWebviewView,
            {} as vscode.WebviewViewResolveContext,
            {} as vscode.CancellationToken
        );

        await provider.refresh();

        assert.ok(postedMessage);
        assert.strictEqual(postedMessage.type, 'update');
    });
});
