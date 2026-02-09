import * as assert from 'assert';
import * as vscode from 'vscode';
import { HighlightService } from '../../services/HighlightService';
import { FilterManager } from '../../services/FilterManager';
import { Logger } from '../../services/Logger';
import { MockExtensionContext } from '../utils/Mocks';

suite('HighlightService Test Suite', () => {
    let highlightService: HighlightService;
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;
    let logger: Logger;

    interface TestEditor extends vscode.TextEditor {
        getDecorations(): Map<vscode.TextEditorDecorationType, vscode.Range[]>;
    }

    // Helper to create a mock editor
    function createMockEditor(content: string): TestEditor {
        const lines = content.split('\n');
        const document = {
            lineCount: lines.length,
            getText: (range?: vscode.Range) => {
                if (!range) {
                    return content;
                }
                // Simple horizontal range extraction for tests if needed
                // For now, we mainly use full text or chunked lines
                const startLine = range.start.line;
                const endLine = range.end.line;
                return lines.slice(startLine, endLine).join('\n');
            },
            lineAt: (line: number) => ({
                text: lines[line],
                range: new vscode.Range(line, 0, line, lines[line].length)
            }),
            offsetAt: (pos: vscode.Position) => {
                let offset = 0;
                for (let i = 0; i < pos.line; i++) {
                    offset += lines[i].length + 1;
                }
                return offset + pos.character;
            },
            positionAt: (offset: number) => {
                let current = 0;
                for (let i = 0; i < lines.length; i++) {
                    const next = current + lines[i].length + 1;
                    if (offset < next) {
                        return new vscode.Position(i, offset - current);
                    }
                    current = next;
                }
                return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
            },
            uri: vscode.Uri.parse('unused://mock')
        };

        const decorations = new Map<vscode.TextEditorDecorationType, vscode.Range[]>();

        return {
            document,
            setDecorations: (type: vscode.TextEditorDecorationType, ranges: vscode.Range[]) => {
                decorations.set(type, ranges);
            },
            getDecorations: () => decorations,
            visibleRanges: [new vscode.Range(0, 0, lines.length, 0)]
        } as unknown as TestEditor;
    }

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);
        logger = Logger.getInstance();
        highlightService = new HighlightService(filterManager, logger);

        // Clear default filters if any
        const groups = filterManager.getGroups();
        groups.forEach(g => filterManager.removeGroup(g.id));
    });

    teardown(() => {
        highlightService.dispose();
    });

    test('updateHighlightsSync: basic include highlight', async () => {
        const content = 'Hello World\nAnother line\nHello again';
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        filterManager.addFilter(group.id, 'Hello', 'include');

        await highlightService.updateHighlights(editor);

        const activeDecorations = editor.getDecorations();
        assert.strictEqual(activeDecorations.size, 1, 'Should have 1 decoration type');

        const ranges = Array.from(activeDecorations.values())[0];
        assert.strictEqual(ranges.length, 2, 'Should have 2 matched ranges');
        assert.strictEqual(ranges[0].start.line, 0);
        assert.strictEqual(ranges[1].start.line, 2);
    });

    test('updateHighlightsSync: exclude hidden style', async () => {
        const content = 'Match 1\nHide this\nMatch 2';
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        const filter = filterManager.addFilter(group.id, 'Hide', 'exclude')!;
        filterManager.setFilterExcludeStyle(group.id, filter.id, 'hidden');

        await highlightService.updateHighlights(editor);

        const activeDecorations = editor.getDecorations();
        // Exclude 'hidden' style creates 1 decoration (transparent text)
        assert.strictEqual(activeDecorations.size, 1, 'Should have 1 decoration for hidden exclude');

        const ranges = Array.from(activeDecorations.values())[0];
        assert.strictEqual(ranges.length, 1);
        assert.strictEqual(ranges[0].start.line, 1);
    });

    test('updateHighlightsSync: exclude line-through style', async () => {
        const content = 'Match 1\nStrike this\nMatch 2';
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        filterManager.addFilter(group.id, 'Strike', 'exclude'); // default is line-through

        await highlightService.updateHighlights(editor);

        const activeDecorations = editor.getDecorations();
        // Exclude 'line-through' style creates 2 decorations (whole line strike + bold keyword)
        assert.strictEqual(activeDecorations.size, 2, 'Should have 2 decorations for line-through exclude');
    });

    test('Highlight Modes: word, line, full-line', async () => {
        const content = 'Keyword is here';
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        const filter = filterManager.addFilter(group.id, 'Keyword', 'include')!;

        // Mode 0: Word (Default)
        await highlightService.updateHighlights(editor);
        let activeDecorations = editor.getDecorations();
        let ranges = Array.from(activeDecorations.values())[0];
        assert.strictEqual(ranges[0].start.character, 0);
        assert.strictEqual(ranges[0].end.character, 7);

        // Mode 1: Line (from keyword to end)
        highlightService.refreshDecorationType();
        editor.getDecorations().clear();
        filterManager.setFilterHighlightMode(group.id, filter.id, 1);
        await highlightService.updateHighlights(editor);
        activeDecorations = editor.getDecorations();
        ranges = Array.from(activeDecorations.values())[0];
        assert.strictEqual(ranges[0].start.character, 0);
        assert.strictEqual(ranges[0].end.character, content.length);

        // Mode 2: Full Line
        highlightService.refreshDecorationType();
        editor.getDecorations().clear();
        filterManager.setFilterHighlightMode(group.id, filter.id, 2);
        await highlightService.updateHighlights(editor);
        activeDecorations = editor.getDecorations();
        ranges = Array.from(activeDecorations.values())[0];
        assert.strictEqual(ranges[0].start.character, 0);
        assert.strictEqual(ranges[0].end.character, content.length);
        // Full line mode also uses isWholeLine: true, but we check line ranges here.
    });

    test('Chunked Highlighting', async () => {
        // Create a content > 5000 lines to trigger chunked mode
        const lines = [];
        for (let i = 0; i < 5100; i++) {
            lines.push(i % 100 === 0 ? 'Trigger' : `Line ${i}`);
        }
        const content = lines.join('\n');
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        filterManager.addFilter(group.id, 'Trigger', 'include');

        const matchCounts = await highlightService.updateHighlights(editor);

        const triggerFilter = group.filters[0];
        assert.strictEqual(matchCounts.get(triggerFilter.id), 51, 'Should match 51 instances across chunks');
    });

});
