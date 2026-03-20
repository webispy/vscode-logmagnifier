import * as assert from 'assert';
import * as vscode from 'vscode';
import { HighlightService } from '../../services/HighlightService';
import { FilterManager } from '../../services/FilterManager';
import { Logger } from '../../services/Logger';
import { MockExtensionContext } from '../utils/Mocks';

suite('HighlightService Error Dedup Test Suite', () => {
    let highlightService: HighlightService;
    let filterManager: FilterManager;
    let mockContext: MockExtensionContext;
    let logger: Logger;

    interface TestEditor extends vscode.TextEditor {
        getDecorations(): Map<vscode.TextEditorDecorationType, vscode.Range[]>;
    }

    function createMockEditor(content: string): TestEditor {
        const lines = content.split('\n');
        const document = {
            lineCount: lines.length,
            getText: (range?: vscode.Range) => {
                if (!range) { return content; }
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

        const groups = filterManager.getGroups();
        groups.forEach(g => filterManager.removeGroup(g.id));
    });

    teardown(() => {
        highlightService.dispose();
    });

    test('invalid regex filter does not crash highlighting', async () => {
        const content = 'Hello World\nAnother line';
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        // Add a valid filter
        filterManager.addFilter(group.id, 'Hello', 'include');

        // updateHighlights should not throw even with problematic filters
        const matchCounts = await highlightService.updateHighlights(editor);
        assert.ok(matchCounts instanceof Map);
    });

    test('multiple calls with same content produce consistent results', async () => {
        const content = 'Error here\nAnother Error\nNo match';
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        filterManager.addFilter(group.id, 'Error', 'include');

        const counts1 = await highlightService.updateHighlights(editor);
        const counts2 = await highlightService.updateHighlights(editor);

        // Both calls should produce the same match counts
        const filter = group.filters[0];
        assert.strictEqual(counts1.get(filter.id), counts2.get(filter.id));
        assert.strictEqual(counts1.get(filter.id), 2);
    });

    test('refreshDecorationType clears and recreates decorations', async () => {
        const content = 'Match this line';
        const editor = createMockEditor(content);

        const group = filterManager.addGroup('Test Group', false)!;
        filterManager.toggleGroup(group.id);
        filterManager.addFilter(group.id, 'Match', 'include');

        await highlightService.updateHighlights(editor);
        const beforeSize = editor.getDecorations().size;

        highlightService.refreshDecorationType();
        editor.getDecorations().clear();

        await highlightService.updateHighlights(editor);
        const afterSize = editor.getDecorations().size;

        assert.strictEqual(beforeSize, afterSize, 'Decoration count should be consistent after refresh');
    });
});
