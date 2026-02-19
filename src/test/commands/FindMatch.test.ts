import * as assert from 'assert';
import * as vscode from 'vscode';
import { FilterExecutionCommandManager } from '../../commands/FilterExecutionCommandManager';
import { FilterManager } from '../../services/FilterManager';
import { LogProcessor } from '../../services/LogProcessor';
import { Logger } from '../../services/Logger';
import { HighlightService } from '../../services/HighlightService';
import { SourceMapService } from '../../services/SourceMapService';
import { MockExtensionContext } from '../utils/Mocks';
import { FilterGroup, FilterItem } from '../../models/Filter';

class MockLogProcessor extends LogProcessor {
    public async processFile(_filePath: string, _activeGroups: FilterGroup[], _options?: unknown): Promise<{ matched: number, processed: number, outputPath: string, lineMapping: number[] }> {
        return { matched: 0, processed: 0, outputPath: '/tmp/output.log', lineMapping: [] };
    }
}

class MockHighlightService extends HighlightService {
    public flashedLine: number | undefined;
    public flashLine(_editor: vscode.TextEditor, line: number, _color?: string): void {
        this.flashedLine = line;
    }
}

suite('FilterExecutionCommandManager - Find Match Test Suite', () => {
    let filterManager: FilterManager;
    let logProcessor: MockLogProcessor;
    let commandManager: FilterExecutionCommandManager;
    let mockContext: MockExtensionContext;
    let highlightService: MockHighlightService;
    let document: vscode.TextDocument;
    let editor: vscode.TextEditor;

    setup(async () => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        logProcessor = new MockLogProcessor();
        const logger = Logger.getInstance();
        highlightService = new MockHighlightService(filterManager, logger);
        const sourceMapService = SourceMapService.getInstance();

        // Mock TreeViews
        const wordTreeView = {} as vscode.TreeView<FilterGroup | FilterItem>;
        const regexTreeView = {} as vscode.TreeView<FilterGroup | FilterItem>;

        commandManager = new FilterExecutionCommandManager(
            mockContext,
            filterManager,
            highlightService,
            logProcessor,
            logger,
            sourceMapService,
            wordTreeView,
            regexTreeView,
            false
        );

        // Create a document with known content
        // Lines:
        // 0: apple
        // 1: banana
        // 2: cherry
        // 3: apple pie
        // 4: date
        document = await vscode.workspace.openTextDocument({
            content: 'apple\nbanana\ncherry\napple pie\ndate',
            language: 'log'
        });
        editor = await vscode.window.showTextDocument(document);
    });

    test('Previous Match - Normal Case', async () => {
        // Find 'apple'
        // Cursor at line 4 ('date')
        // Should find match at line 3 ('apple pie')

        const item = {
            id: '1',
            keyword: 'apple',
            isRegex: false,
            isEnabled: true,
            caseSensitive: false,
            color: '#FF0000'
        } as FilterItem;

        // Set cursor to end of file
        const lastLine = document.lineAt(document.lineCount - 1);
        editor.selection = new vscode.Selection(lastLine.range.end, lastLine.range.end);

        // Execute previous match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).findMatch(item, 'previous');

        // Check selection matches line 3 'apple'
        const selection = editor.selection;
        assert.strictEqual(selection.start.line, 3);
        assert.strictEqual(document.getText(selection), 'apple');
    });

    test('Previous Match - Wrapping Case', async () => {
        // Find 'apple'
        // Cursor at line 0 ('apple'), at the START (offset 0)
        // Should find the LAST match in the file (line 3 'apple') IF we wrap properly
        // Or if we are inside the first match, previous should wrap to last

        const item = {
            id: '1',
            keyword: 'apple',
            isRegex: false,
            isEnabled: true,
            caseSensitive: false,
            color: '#FF0000'
        } as FilterItem;

        // Set cursor to start of file (0,0) - which is start of first 'apple'
        editor.selection = new vscode.Selection(0, 0, 0, 0);

        // Execute previous match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).findMatch(item, 'previous');

        // Check selection matches line 3 'apple' (the last one)
        const selection = editor.selection;
        assert.strictEqual(selection.start.line, 3);
        assert.strictEqual(document.getText(selection), 'apple');
    });

    test('Previous Match - Between Matches', async () => {
        // Find 'apple'
        // Cursor at line 2 ('cherry')
        // Should find match at line 0 ('apple')

        const item = {
            id: '1',
            keyword: 'apple',
            isRegex: false,
            isEnabled: true,
            caseSensitive: false,
            color: '#FF0000'
        } as FilterItem;

        // Set cursor to line 2
        const line2 = document.lineAt(2);
        editor.selection = new vscode.Selection(line2.range.start, line2.range.start);

        // Execute previous match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).findMatch(item, 'previous');

        // Check selection matches line 0 'apple'
        const selection = editor.selection;
        assert.strictEqual(selection.start.line, 0);
        assert.strictEqual(document.getText(selection), 'apple');
        assert.strictEqual(document.getText(selection), 'apple');
    });

    test('Previous Match - Stuck on Same Match Bug', async () => {
        // Text: apple\nbanana\ncherry\napple pie\ndate
        // Matches: 'apple' at line 0 (index 0) and line 3 (index ~20)

        // Select the second 'apple' (at line 3)
        // Line 0: "apple\n" (6 chars)
        // Line 1: "banana\n" (7 chars)
        // Line 2: "cherry\n" (7 chars) -> Total 20
        // Line 3: "apple pie\n" -> 'apple' is at 20

        const item = {
            id: '1',
            keyword: 'apple',
            isRegex: false,
            isEnabled: true,
            caseSensitive: false,
            color: '#FF0000'
        } as FilterItem;

        // Simulate "Next Match" selection (anchor=start, active=end) for the second apple
        const line3 = document.lineAt(3);
        const matchStart = line3.range.start;
        const matchEnd = matchStart.translate(0, 5); // 'apple'.length
        editor.selection = new vscode.Selection(matchStart, matchEnd);

        // Verify setup
        assert.strictEqual(document.getText(editor.selection), 'apple');
        assert.strictEqual(editor.selection.active.line, 3);

        // Execute previous match - Should go to line 0 'apple'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).findMatch(item, 'previous');

        // Check selection matches line 0 'apple'
        const selection = editor.selection;
        assert.strictEqual(selection.start.line, 0, 'Should have moved to previous match at line 0');
        assert.strictEqual(document.getText(selection), 'apple');
    });

    // --- Next Match Tests ---

    test('Next Match - Normal Case', async () => {
        // Find 'apple'
        // Cursor at line 0 ('apple')
        // Should find match at line 3 ('apple pie')

        const item = {
            id: '1',
            keyword: 'apple',
            isRegex: false,
            isEnabled: true,
            caseSensitive: false,
            color: '#FF0000'
        } as FilterItem;

        // Set cursor to start of file (0,0) inclusive of first match
        editor.selection = new vscode.Selection(0, 0, 0, 5); // Select first 'apple'

        // Execute next match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).findMatch(item, 'next');

        // Check selection matches line 3 'apple'
        const selection = editor.selection;
        assert.strictEqual(selection.start.line, 3);
        assert.strictEqual(document.getText(selection), 'apple');
    });

    test('Next Match - Wrapping Case', async () => {
        // Find 'apple'
        // Cursor at line 3 ('apple pie') - last match
        // Should wrap to line 0 ('apple')

        const item = {
            id: '1',
            keyword: 'apple',
            isRegex: false,
            isEnabled: true,
            caseSensitive: false,
            color: '#FF0000'
        } as FilterItem;

        // Set cursor to last match
        const line3 = document.lineAt(3);
        editor.selection = new vscode.Selection(line3.range.start, line3.range.start.translate(0, 5));

        // Execute next match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).findMatch(item, 'next');

        // Check selection matches line 0 'apple'
        const selection = editor.selection;
        assert.strictEqual(selection.start.line, 0);
        assert.strictEqual(document.getText(selection), 'apple');
    });

    test('Next Match - Between Matches', async () => {
        // Find 'apple'
        // Cursor at line 2 ('cherry')
        // Should find match at line 3 ('apple pie')

        const item = {
            id: '1',
            keyword: 'apple',
            isRegex: false,
            isEnabled: true,
            caseSensitive: false,
            color: '#FF0000'
        } as FilterItem;

        // Set cursor to line 2
        const line2 = document.lineAt(2);
        editor.selection = new vscode.Selection(line2.range.start, line2.range.start);

        // Execute next match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).findMatch(item, 'next');

        // Check selection matches line 3 'apple'
        const selection = editor.selection;
        assert.strictEqual(selection.start.line, 3);
        assert.strictEqual(document.getText(selection), 'apple');
    });
});
