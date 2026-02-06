import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { LogBookmarkService } from '../../services/LogBookmarkService';
import { Constants } from '../../constants';

suite('Bookmark Integration Test Suite', () => {
    let bookmarkService: LogBookmarkService;

    const resourcesDir = path.join(__dirname, '..', '..', '..', 'src', 'test', 'resources');
    const androidLogUri = vscode.Uri.file(path.join(resourcesDir, 'test_log_android.log'));
    const sampleLogUri = vscode.Uri.file(path.join(resourcesDir, 'sample.log'));

    setup(async () => {
        // Get the extension and its API
        const extension = vscode.extensions.getExtension('webispy.logmagnifier');
        if (!extension) {
            throw new Error('Extension not found');
        }
        if (!extension.isActive) {
            await extension.activate();
        }

        const api = extension.exports;
        bookmarkService = api.bookmarkService;

        // Clear any existing state
        await vscode.commands.executeCommand(Constants.Commands.RemoveAllBookmarks);
    });

    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    test('Basic Operations: add, remove, toggle', async () => {
        const editor = await vscode.window.showTextDocument(androidLogUri);

        // 1. Add Bookmark via service
        const result = bookmarkService.addBookmark(editor, 10);
        assert.strictEqual(result.success, true);
        assert.strictEqual(bookmarkService.getActiveLinesCount(), 1);

        const bookmark = bookmarkService.getBookmarkAt(androidLogUri, 10);
        assert.ok(bookmark);
        assert.strictEqual(bookmark.line, 10);

        // 2. Toggle Bookmark via command (Remove)
        // Reset selection to line 10
        editor.selection = new vscode.Selection(10, 0, 10, 0);
        await vscode.commands.executeCommand(Constants.Commands.ToggleBookmark);
        assert.strictEqual(bookmarkService.getActiveLinesCount(), 0);

        // 3. Toggle Bookmark via command (Add)
        editor.selection = new vscode.Selection(20, 0, 20, 0);
        await vscode.commands.executeCommand(Constants.Commands.ToggleBookmark);
        assert.strictEqual(bookmarkService.getActiveLinesCount(), 1);
        assert.ok(bookmarkService.getBookmarkAt(androidLogUri, 20));

        // 4. Remove Bookmark via command
        const item = bookmarkService.getBookmarkAt(androidLogUri, 20)!;
        await vscode.commands.executeCommand(Constants.Commands.RemoveBookmark, item);
        assert.strictEqual(bookmarkService.getActiveLinesCount(), 0);
    });

    test('Add matches to bookmark', async () => {
        const editor = await vscode.window.showTextDocument(androidLogUri);

        // Find "Access denied" on line 49 (which is line 50 in 1-indexed view)
        const lineContent = editor.document.lineAt(49).text;
        const matchText = "Access denied";
        const startIndex = lineContent.indexOf(matchText);
        assert.ok(startIndex !== -1, "Could not find 'Access denied' on line 49");

        // Select "Access denied"
        editor.selection = new vscode.Selection(49, startIndex, 49, startIndex + matchText.length);

        // Trigger command to add matches
        await vscode.commands.executeCommand(Constants.Commands.AddSelectionMatchesToBookmark);

        // In test_log_android.log, "Access denied" appears exactly 4 times
        assert.strictEqual(bookmarkService.getActiveLinesCount(), 4);

        const bookmarks = bookmarkService.getBookmarks().get(androidLogUri.toString())!;
        assert.strictEqual(bookmarks.length, 4);
        assert.ok(bookmarks.every(b => b.content.includes(matchText)));
    });

    test('Delete by tag (groupId)', async () => {
        const editor = await vscode.window.showTextDocument(androidLogUri);

        bookmarkService.addBookmark(editor, 5, { groupId: 'group-a' });
        bookmarkService.addBookmark(editor, 15, { groupId: 'group-a' });
        bookmarkService.addBookmark(editor, 25, { groupId: 'group-b' });

        assert.strictEqual(bookmarkService.getActiveLinesCount(), 3);

        await vscode.commands.executeCommand(Constants.Commands.RemoveBookmarkGroup, 'group-a');
        assert.strictEqual(bookmarkService.getActiveLinesCount(), 1);
        assert.ok(bookmarkService.getBookmarkAt(androidLogUri, 25));
    });

    test('Multiple file support', async () => {
        const editorAndroid = await vscode.window.showTextDocument(androidLogUri);
        bookmarkService.addBookmark(editorAndroid, 10);

        const editorSample = await vscode.window.showTextDocument(sampleLogUri);
        bookmarkService.addBookmark(editorSample, 5);

        assert.strictEqual(bookmarkService.getActiveLinesCount(), 2);

        // Remove for one URI via command
        await vscode.commands.executeCommand(Constants.Commands.RemoveBookmarkFile, androidLogUri);
        assert.strictEqual(bookmarkService.getActiveLinesCount(), 1);
        assert.strictEqual(bookmarkService.getBookmarkAt(androidLogUri, 10), undefined);
        assert.ok(bookmarkService.getBookmarkAt(sampleLogUri, 5));
    });

    test('Jump to bookmark', async () => {
        const editor = await vscode.window.showTextDocument(androidLogUri);
        bookmarkService.addBookmark(editor, 100);
        const bookmark = bookmarkService.getBookmarkAt(androidLogUri, 100)!;

        // Move cursor somewhere else
        editor.selection = new vscode.Selection(0, 0, 0, 0);

        // Jump via command
        await vscode.commands.executeCommand(Constants.Commands.JumpToBookmark, bookmark);

        await wait(500);
        const activeEditor = vscode.window.activeTextEditor;
        assert.strictEqual(activeEditor?.document.uri.toString(), androidLogUri.toString());
        assert.strictEqual(activeEditor?.selection.active.line, 100);
    });

    test('Result operations: clipboard and settings', async () => {
        const editor = await vscode.window.showTextDocument(androidLogUri);
        bookmarkService.addBookmark(editor, 10);

        // 1. Toggle Word Wrap
        const initialWordWrap = bookmarkService.isWordWrapEnabled();
        await vscode.commands.executeCommand(Constants.Commands.ToggleBookmarkWordWrap);
        assert.strictEqual(bookmarkService.isWordWrapEnabled(), !initialWordWrap);

        // 2. Copy All Bookmarks
        await vscode.commands.executeCommand(Constants.Commands.CopyAllBookmarks);
        const clipboardText = await vscode.env.clipboard.readText();
        assert.ok(clipboardText.includes('Line 11:'));

        // 3. Open All Bookmarks (Check if a new untitled document is opened)
        await vscode.commands.executeCommand(Constants.Commands.OpenAllBookmarks);
        await wait(500);
        const activeDoc = vscode.window.activeTextEditor?.document;
        assert.ok(activeDoc?.isUntitled);
        assert.ok(activeDoc?.uri.path.includes('All Bookmarks'));
    });
});
