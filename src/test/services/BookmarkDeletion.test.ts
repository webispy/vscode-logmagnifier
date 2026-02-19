
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { LogBookmarkService } from '../../services/LogBookmarkService';
import { Constants } from '../../Constants';
// Integration tests rely on public behavior (UI updates, exposed state).

suite('Bookmark Deletion & Watcher Integration Test Suite', function () {
    this.timeout(10000);
    let bookmarkService: LogBookmarkService;

    // Use a temporary file in the workspace or system temp for deletion tests
    const tempDir = path.join(__dirname, '..', '..', '..', 'src', 'test', 'runTest_resources');
    const tempFileUri = vscode.Uri.file(path.join(tempDir, 'temp_delete_test.log'));

    setup(async () => {
        // Ensure extension is active
        const extension = vscode.extensions.getExtension('webispy.logmagnifier');
        if (!extension) {
            throw new Error('Extension not found');
        }
        if (!extension.isActive) {
            await extension.activate();
        }

        const api = extension.exports;
        bookmarkService = api.bookmarkService;

        // Clear bookmarks
        await vscode.commands.executeCommand(Constants.Commands.RemoveAllBookmarks);

        // create temp dir if not exists
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        // Create a dummy log file
        fs.writeFileSync(tempFileUri.fsPath, 'Line 1\nLine 2\nLine 3\nLine 4\n');
    });

    teardown(async () => {
        // Cleanup temp file
        if (fs.existsSync(tempFileUri.fsPath)) {
            fs.unlinkSync(tempFileUri.fsPath);
        }
        await vscode.commands.executeCommand(Constants.Commands.RemoveAllBookmarks);
    });

    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const waitForCondition = async (condition: () => boolean, timeout = 5000, interval = 200) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (condition()) {
                return true;
            }
            await wait(interval);
        }
        return false;
    };

    test('Detects file deletion and marks bookmark as missing', async () => {
        // 1. Open file and add bookmark
        const doc = await vscode.workspace.openTextDocument(tempFileUri);
        const editor = await vscode.window.showTextDocument(doc);
        bookmarkService.addBookmark(editor, 1); // Line 2

        // Give watcher time to initialize
        await wait(500);

        assert.strictEqual(bookmarkService.isFileMissing(tempFileUri.toString()), false, 'File should not be missing initially');

        // 2. Delete the file externally

        fs.unlinkSync(tempFileUri.fsPath);

        // 3. Wait for watcher to trigger
        const success = await waitForCondition(() => bookmarkService.isFileMissing(tempFileUri.toString()));
        assert.ok(success, 'File should be marked as missing after deletion (timed out)');
    });

    test('Detects file restoration and unmarks bookmark as missing', async () => {
        // 1. Setup: Bookmark a file, then delete it
        const doc = await vscode.workspace.openTextDocument(tempFileUri);
        const editor = await vscode.window.showTextDocument(doc);
        bookmarkService.addBookmark(editor, 2);

        // Give watcher time to initialize
        await wait(500);

        fs.unlinkSync(tempFileUri.fsPath);
        const deleted = await waitForCondition(() => bookmarkService.isFileMissing(tempFileUri.toString()));
        assert.ok(deleted, 'File should be missing after deletion');

        // 2. Restore file
        fs.writeFileSync(tempFileUri.fsPath, 'Restored content\nLine 2\nLine 3\n');

        // 3. Wait for watcher
        const restored = await waitForCondition(() => !bookmarkService.isFileMissing(tempFileUri.toString()));
        assert.ok(restored, 'File should be detected as restored (timed out)');
    });

    test('External file watcher (outside workspace)', async function () {
        // Create a file in a temp directory OUTSIDE the workspace
        // Assuming the test workspace is not the system temp dir

        const os = await import('os');
        const externalTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-test-ext-'));
        const externalFile = path.join(externalTempDir, 'external.log');
        const externalUri = vscode.Uri.file(externalFile);

        try {
            fs.writeFileSync(externalFile, 'External Log\nLine 2\n');

            // Open and bookmark
            const doc = await vscode.workspace.openTextDocument(externalUri);
            const editor = await vscode.window.showTextDocument(doc);
            bookmarkService.addBookmark(editor, 0);

            // Give watcher time to initialize
            await wait(500);

            assert.strictEqual(bookmarkService.isFileMissing(externalUri.toString()), false);

            // Delete external file
            fs.unlinkSync(externalFile);

            // Wait for watcher
            const success = await waitForCondition(() => bookmarkService.isFileMissing(externalUri.toString()));
            assert.ok(success, 'External file deletion should be detected (timed out)');

        } finally {
            // Cleanup
            if (fs.existsSync(externalFile)) { fs.unlinkSync(externalFile); }
            if (fs.existsSync(externalTempDir)) { fs.rmdirSync(externalTempDir); }
        }
    });
});
