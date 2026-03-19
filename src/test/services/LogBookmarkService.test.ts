import * as assert from 'assert';
import * as vscode from 'vscode';
import { LogBookmarkService } from '../../services/LogBookmarkService';
import { MockExtensionContext } from '../utils/Mocks';

suite('LogBookmarkService Test Suite', () => {
    let service: LogBookmarkService;
    let mockContext: MockExtensionContext;

    function createMockEditor(uri: vscode.Uri, lines: string[]): vscode.TextEditor {
        const document = {
            uri,
            lineCount: lines.length,
            lineAt: (line: number) => ({
                text: lines[line] || '',
                range: new vscode.Range(line, 0, line, (lines[line] || '').length)
            }),
            getText: () => lines.join('\n'),
        } as unknown as vscode.TextDocument;

        return {
            document,
            selection: new vscode.Selection(0, 0, 0, 0),
            setDecorations: () => { },
        } as unknown as vscode.TextEditor;
    }

    setup(() => {
        mockContext = new MockExtensionContext();
        service = new LogBookmarkService(mockContext);
    });

    teardown(() => {
        service.dispose();
    });

    suite('Add and Remove Bookmarks', () => {
        test('Should add a bookmark and retrieve it', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0', 'line 1', 'line 2']);

            const result = service.addBookmark(editor, 1);
            assert.strictEqual(result.success, true);

            const bookmark = service.getBookmarkAt(uri, 1);
            assert.ok(bookmark, 'bookmark should exist at line 1');
            assert.strictEqual(bookmark.line, 1);
            assert.strictEqual(bookmark.content, 'line 1');
        });

        test('Should reject duplicate bookmark on same line', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0', 'line 1']);

            service.addBookmark(editor, 0);
            const result = service.addBookmark(editor, 0);
            assert.strictEqual(result.success, false);
            assert.ok(result.message?.includes('already exists'));
        });

        test('Should allow same line with different matchText', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['error: something failed']);

            const r1 = service.addBookmark(editor, 0, { matchText: 'error' });
            const r2 = service.addBookmark(editor, 0, { matchText: 'failed' });
            assert.strictEqual(r1.success, true);
            assert.strictEqual(r2.success, true);
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 2);
        });

        test('Should remove a bookmark', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0']);

            service.addBookmark(editor, 0);
            const bookmark = service.getBookmarkAt(uri, 0);
            assert.ok(bookmark);

            service.removeBookmark(bookmark);
            assert.strictEqual(service.getBookmarkAt(uri, 0), undefined);
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 0);
        });

        test('Should remove all bookmarks for a URI', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0', 'line 1', 'line 2']);

            service.addBookmark(editor, 0);
            service.addBookmark(editor, 1);
            service.addBookmark(editor, 2);
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 3);

            service.removeBookmarksForUri(uri);
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 0);
        });

        test('Should remove all bookmarks globally', () => {
            const uri1 = vscode.Uri.parse('file:///test/a.log');
            const uri2 = vscode.Uri.parse('file:///test/b.log');
            const editor1 = createMockEditor(uri1, ['a']);
            const editor2 = createMockEditor(uri2, ['b']);

            service.addBookmark(editor1, 0);
            service.addBookmark(editor2, 0);
            assert.strictEqual(service.getActiveLinesCount(), 2);

            service.removeAllBookmarks();
            assert.strictEqual(service.getActiveLinesCount(), 0);
            assert.strictEqual(service.getBookmarks().size, 0);
        });
    });

    suite('Toggle Bookmark', () => {
        test('Should add bookmark when none exists', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0']);

            const result = service.toggleBookmark(editor, 0);
            assert.strictEqual(result.success, true);
            assert.ok(service.getBookmarkAt(uri, 0));
        });

        test('Should remove bookmark when one exists', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0']);

            service.addBookmark(editor, 0);
            const result = service.toggleBookmark(editor, 0);
            assert.strictEqual(result.success, true);
            assert.strictEqual(service.getBookmarkAt(uri, 0), undefined);
        });
    });

    suite('URI Scheme Validation', () => {
        test('Should reject output panel bookmarks', () => {
            const uri = vscode.Uri.parse('output:///test');
            const editor = createMockEditor(uri, ['output line']);

            const result = service.addBookmark(editor, 0);
            assert.strictEqual(result.success, false);
            assert.ok(result.message?.includes('output'));
        });

        test('Should reject debug console bookmarks', () => {
            const uri = vscode.Uri.parse('debug:///test');
            const editor = createMockEditor(uri, ['debug line']);

            const result = service.addBookmark(editor, 0);
            assert.strictEqual(result.success, false);
            assert.ok(result.message?.includes('debug'));
        });

        test('Should reject terminal bookmarks', () => {
            const uri = vscode.Uri.parse('vscode-terminal:///test');
            const editor = createMockEditor(uri, ['terminal line']);

            const result = service.addBookmark(editor, 0);
            assert.strictEqual(result.success, false);
            assert.ok(result.message?.includes('terminal'));
        });

        test('Should reject invalid line numbers', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0']);

            assert.strictEqual(service.addBookmark(editor, -1).success, false);
            assert.strictEqual(service.addBookmark(editor, 5).success, false);
        });
    });

    suite('Batch Add Bookmarks', () => {
        test('Should add multiple bookmarks at once', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['a', 'b', 'c', 'd']);

            const count = service.addBookmarks(editor, [0, 2, 3]);
            assert.strictEqual(count, 3);
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 3);
        });

        test('Should skip duplicates in batch add', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['a', 'b', 'c']);

            service.addBookmark(editor, 1);
            const count = service.addBookmarks(editor, [0, 1, 2]);
            assert.strictEqual(count, 2, 'should only add 2 new bookmarks');
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 3);
        });
    });

    suite('LIFO File Ordering', () => {
        test('Should maintain LIFO order for file keys', () => {
            const uri1 = vscode.Uri.parse('file:///test/first.log');
            const uri2 = vscode.Uri.parse('file:///test/second.log');
            const uri3 = vscode.Uri.parse('file:///test/third.log');

            const editor1 = createMockEditor(uri1, ['a']);
            const editor2 = createMockEditor(uri2, ['b']);
            const editor3 = createMockEditor(uri3, ['c']);

            service.addBookmark(editor1, 0);
            service.addBookmark(editor2, 0);
            service.addBookmark(editor3, 0);

            const keys = service.getFileKeys();
            assert.strictEqual(keys[0], uri3.toString(), 'last added file should be first');
            assert.strictEqual(keys[1], uri2.toString());
            assert.strictEqual(keys[2], uri1.toString());
        });

        test('Should move file to top when new bookmark added', () => {
            const uri1 = vscode.Uri.parse('file:///test/first.log');
            const uri2 = vscode.Uri.parse('file:///test/second.log');

            const editor1 = createMockEditor(uri1, ['a', 'b']);
            const editor2 = createMockEditor(uri2, ['c']);

            service.addBookmark(editor1, 0);
            service.addBookmark(editor2, 0);
            // Add another bookmark to first file -> should move to top
            service.addBookmark(editor1, 1);

            const keys = service.getFileKeys();
            assert.strictEqual(keys[0], uri1.toString(), 'first file should be at top after second add');
        });
    });

    suite('Group Management', () => {
        test('Should count unique history groups', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['a', 'b', 'c']);

            service.addBookmark(editor, 0, { groupId: 'group-1' });
            service.addBookmark(editor, 1, { groupId: 'group-1' });
            service.addBookmark(editor, 2, { groupId: 'group-2' });

            assert.strictEqual(service.getFileHistoryGroupsCount(uri.toString()), 2);
            assert.strictEqual(service.getHistoryGroupsCount(), 2);
        });

        test('Should remove bookmarks by group ID', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['a', 'b', 'c']);

            service.addBookmark(editor, 0, { groupId: 'keep' });
            service.addBookmark(editor, 1, { groupId: 'remove' });
            service.addBookmark(editor, 2, { groupId: 'remove' });

            service.removeBookmarkGroup('remove');
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 1);
            assert.ok(service.getBookmarkAt(uri, 0));
            assert.strictEqual(service.getBookmarkAt(uri, 1), undefined);
        });

        test('Should clean up URI entry when group removal empties all bookmarks', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['a']);

            service.addBookmark(editor, 0, { groupId: 'only-group' });
            service.removeBookmarkGroup('only-group');

            assert.strictEqual(service.getBookmarks().size, 0);
        });
    });

    suite('Settings Toggles', () => {
        test('Should toggle word wrap', () => {
            assert.strictEqual(service.isWordWrapEnabled(), false);
            service.toggleWordWrap();
            assert.strictEqual(service.isWordWrapEnabled(), true);
            service.toggleWordWrap();
            assert.strictEqual(service.isWordWrapEnabled(), false);
        });

        test('Should toggle include line numbers per file', () => {
            const key = 'file:///test/file.log';
            assert.strictEqual(service.isIncludeLineNumbersEnabled(key), false);
            service.toggleIncludeLineNumbers(key);
            assert.strictEqual(service.isIncludeLineNumbersEnabled(key), true);
            service.toggleIncludeLineNumbers(key);
            assert.strictEqual(service.isIncludeLineNumbersEnabled(key), false);
        });
    });

    suite('Defensive Copy', () => {
        test('getBookmarks should return a defensive copy', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0']);

            service.addBookmark(editor, 0);

            const copy = service.getBookmarks();
            const items = copy.get(uri.toString());
            assert.ok(items);
            items.push({} as unknown as import('../../models/Bookmark').BookmarkItem); // mutate the copy

            // Original should be unaffected
            assert.strictEqual(service.getFileActiveLinesCount(uri.toString()), 1);
        });
    });

    suite('Bookmarks Sorted By Line', () => {
        test('Should keep bookmarks sorted by line number', () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['a', 'b', 'c', 'd', 'e']);

            service.addBookmark(editor, 4);
            service.addBookmark(editor, 1);
            service.addBookmark(editor, 3);

            const bookmarks = service.getBookmarks().get(uri.toString())!;
            assert.strictEqual(bookmarks[0].line, 1);
            assert.strictEqual(bookmarks[1].line, 3);
            assert.strictEqual(bookmarks[2].line, 4);
        });
    });

    suite('Event Emissions', () => {
        test('Should fire onDidChangeBookmarks on add', (done) => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0']);

            service.onDidChangeBookmarks(() => {
                done();
            });

            service.addBookmark(editor, 0);
        });

        test('Should fire onDidAddBookmark with correct URI', (done) => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0']);

            service.onDidAddBookmark(addedUri => {
                assert.strictEqual(addedUri.toString(), uri.toString());
                done();
            });

            service.addBookmark(editor, 0);
        });
    });

    suite('State Persistence', () => {
        test('Should persist and reload bookmarks across instances', async () => {
            const uri = vscode.Uri.parse('file:///test/file.log');
            const editor = createMockEditor(uri, ['line 0', 'line 1']);

            service.addBookmark(editor, 0);
            service.addBookmark(editor, 1);
            service.toggleWordWrap();

            // Wait for async saveToState
            await new Promise(resolve => setTimeout(resolve, 50));

            // Create new service with same context (simulates reload)
            service.dispose();
            const reloaded = new LogBookmarkService(mockContext);

            assert.strictEqual(reloaded.getActiveLinesCount(), 2);
            assert.strictEqual(reloaded.isWordWrapEnabled(), true);

            const keys = reloaded.getFileKeys();
            assert.strictEqual(keys.length, 1);
            assert.strictEqual(keys[0], uri.toString());

            reloaded.dispose();
        });
    });
});
