import * as assert from 'assert';
import * as vscode from 'vscode';
import { LogBookmarkWebviewProvider } from '../../views/LogBookmarkWebviewProvider';
import { LogBookmarkService } from '../../services/LogBookmarkService';
import { Logger } from '../../services/Logger';
import { MockExtensionContext } from '../utils/Mocks';

suite('LogBookmarkWebviewProvider Test Suite', () => {
    let provider: LogBookmarkWebviewProvider;
    let bookmarkService: LogBookmarkService;
    let logger: Logger;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        logger = {
            error: () => { },
            info: () => { },
            warn: () => { },
            debug: () => { },
            dispose: () => { }
        } as unknown as Logger;

        bookmarkService = new LogBookmarkService(mockContext as unknown as vscode.ExtensionContext);

        provider = new LogBookmarkWebviewProvider(
            vscode.Uri.file('/mock/ext'),
            bookmarkService,
            logger
        );
    });

    teardown(() => {
        provider.dispose();
        bookmarkService.dispose();
    });

    test('resolveWebviewView sets up webview', () => {
        let listenerRegistered = false;
        const mockWebviewView = {
            webview: {
                options: {},
                onDidReceiveMessage: (_listener: unknown) => {
                    listenerRegistered = true;
                },
                html: ''
            }
        } as unknown as vscode.WebviewView;

        provider.resolveWebviewView(
            mockWebviewView,
            {} as vscode.WebviewViewResolveContext,
            {} as vscode.CancellationToken
        );

        assert.strictEqual(listenerRegistered, true, 'Message listener should be registered');
    });

    test('dispose cleans up resources', () => {
        assert.doesNotThrow(() => {
            provider.dispose();
        });
    });
});
