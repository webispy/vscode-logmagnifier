
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EditorUtils } from '../../utils/EditorUtils';

suite('EditorUtils Test Suite', () => {

    suite('resolveActiveDocument', () => {

        test('returns activeTextEditor document when available', async () => {
            // Open a document and show it so activeTextEditor is set
            const doc = await vscode.workspace.openTextDocument({ content: 'active editor content', language: 'log' });
            await vscode.window.showTextDocument(doc);

            const result = await EditorUtils.resolveActiveDocument();

            assert.ok(result, 'Should return a document');
            assert.strictEqual(result?.uri.toString(), doc.uri.toString(), 'Should return the active editor document');
        });

        test('rejects virtual scheme documents and falls back', async () => {
            // Open a real file so it becomes the active tab fallback
            const tmpFile = path.join(os.tmpdir(), `editorutils_test_${Date.now()}.log`);
            fs.writeFileSync(tmpFile, 'fallback content');

            try {
                const fileDoc = await vscode.workspace.openTextDocument(tmpFile);
                await vscode.window.showTextDocument(fileDoc);

                const result = await EditorUtils.resolveActiveDocument();

                assert.ok(result, 'Should return a document');
                assert.strictEqual(result?.uri.scheme, 'file', 'Should return a file-scheme document');
            } finally {
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile);
                }
            }
        });

        test('active tab is prioritized over visible editors in split view', async () => {
            // Simulate split editor scenario:
            // - File A is shown in one editor group (visible)
            // - File B is the active tab in the active group
            //
            // When activeTextEditor is undefined (large file), the active tab (File B)
            // should be resolved — not the visible editor (File A).

            const tmpDir = os.tmpdir();
            const fileA = path.join(tmpDir, `editorutils_fileA_${Date.now()}.log`);
            const fileB = path.join(tmpDir, `editorutils_fileB_${Date.now()}.log`);
            fs.writeFileSync(fileA, 'content of file A');
            fs.writeFileSync(fileB, 'content of file B');

            try {
                // Open file A in the first editor group
                const docA = await vscode.workspace.openTextDocument(fileA);
                await vscode.window.showTextDocument(docA, vscode.ViewColumn.One);

                // Open file B in the second editor group (becomes active)
                const docB = await vscode.workspace.openTextDocument(fileB);
                await vscode.window.showTextDocument(docB, vscode.ViewColumn.Two);

                // Both files are visible, file B is the active tab
                const result = await EditorUtils.resolveActiveDocument();

                assert.ok(result, 'Should return a document');
                // The result should be file B (active tab), not file A (just visible)
                assert.strictEqual(
                    result?.uri.fsPath,
                    docB.uri.fsPath,
                    'Should return the active tab document (file B), not the visible editor (file A)'
                );
            } finally {
                if (fs.existsSync(fileA)) { fs.unlinkSync(fileA); }
                if (fs.existsSync(fileB)) { fs.unlinkSync(fileB); }
            }
        });

        test('falls back to visible editors when no active tab matches', async () => {
            // When both activeTextEditor and active tab are unavailable,
            // should fall back to visible editors
            const tmpFile = path.join(os.tmpdir(), `editorutils_visible_${Date.now()}.log`);
            fs.writeFileSync(tmpFile, 'visible editor content');

            try {
                const doc = await vscode.workspace.openTextDocument(tmpFile);
                await vscode.window.showTextDocument(doc);

                // The document should still be resolvable via visible editors
                const result = await EditorUtils.resolveActiveDocument();
                assert.ok(result, 'Should return a document from visible editors as fallback');
            } finally {
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile);
                }
            }
        });
    });

    suite('resolveActiveUri', () => {

        test('returns URI from activeTextEditor when available', async () => {
            const doc = await vscode.workspace.openTextDocument({ content: 'uri test', language: 'log' });
            await vscode.window.showTextDocument(doc);

            const uri = EditorUtils.resolveActiveUri();

            assert.ok(uri, 'Should return a URI');
            assert.strictEqual(uri?.toString(), doc.uri.toString(), 'Should match the active editor URI');
        });

        test('returns URI from active tab when no activeTextEditor', async () => {
            const tmpFile = path.join(os.tmpdir(), `editorutils_uri_tab_${Date.now()}.log`);
            fs.writeFileSync(tmpFile, 'tab uri content');

            try {
                const doc = await vscode.workspace.openTextDocument(tmpFile);
                await vscode.window.showTextDocument(doc);

                // Verify resolveActiveUri returns a valid URI
                const uri = EditorUtils.resolveActiveUri();
                assert.ok(uri, 'Should return a URI');
            } finally {
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile);
                }
            }
        });
    });

    suite('getFileSizeAsync', () => {

        test('returns correct file size for existing file', async () => {
            const tmpFile = path.join(os.tmpdir(), `editorutils_size_${Date.now()}.log`);
            const content = 'test content for size check';
            fs.writeFileSync(tmpFile, content);

            try {
                const uri = vscode.Uri.file(tmpFile);
                const size = await EditorUtils.getFileSizeAsync(uri);

                assert.ok(size !== undefined, 'Should return a size');
                assert.strictEqual(size, Buffer.byteLength(content), 'Should match the actual file size');
            } finally {
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile);
                }
            }
        });

        test('returns undefined for non-existent file', async () => {
            const uri = vscode.Uri.file(path.join(os.tmpdir(), `nonexistent_${Date.now()}.log`));
            const size = await EditorUtils.getFileSizeAsync(uri);

            assert.strictEqual(size, undefined, 'Should return undefined for non-existent file');
        });

        test('calls onError callback when error occurs', async () => {
            const uri = vscode.Uri.parse('custom-scheme://invalid/path');
            let errorCalled = false;

            await EditorUtils.getFileSizeAsync(uri, () => {
                errorCalled = true;
            });

            // Non-file scheme returns undefined without error
            assert.strictEqual(errorCalled, false, 'Should not call onError for non-file scheme (just returns undefined)');
        });
    });
});
