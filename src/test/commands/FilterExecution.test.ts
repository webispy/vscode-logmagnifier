
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilterExecutionCommandManager } from '../../commands/FilterExecutionCommandManager';
import { FilterManager } from '../../services/FilterManager';
import { LogProcessor } from '../../services/LogProcessor';
import { Logger } from '../../services/Logger';
import { HighlightService } from '../../services/HighlightService';
import { SourceMapService } from '../../services/SourceMapService';
import { MockExtensionContext } from '../utils/Mocks';
import { FilterGroup, FilterItem } from '../../models/Filter';
import { EditorUtils } from '../../utils/EditorUtils';

// Mock LogProcessor to capture processed groups without real file I/O
class MockLogProcessor extends LogProcessor {
    public lastProcessedGroups: FilterGroup[] = [];

    constructor() {
        super();
    }

    public async processFile(_filePath: string, activeGroups: FilterGroup[], _options?: unknown): Promise<{ matched: number, processed: number, outputPath: string, lineMapping: number[] }> {
        this.lastProcessedGroups = activeGroups;
        return { matched: 0, processed: 0, outputPath: '/tmp/output.log', lineMapping: [] };
    }
}

// Mock FilterManager to setup test scenarios
class MockFilterManager extends FilterManager {
    constructor() {
        super(new MockExtensionContext());
        // Clear all initial groups
        const groups = this.getGroups();
        [...groups].forEach(g => this.removeGroup(g.id));
    }
}

suite('FilterExecutionCommandManager Test Suite', () => {
    let filterManager: MockFilterManager;
    let logProcessor: MockLogProcessor;
    let commandManager: FilterExecutionCommandManager;
    let mockContext: MockExtensionContext;

    setup(async () => {
        mockContext = new MockExtensionContext();
        filterManager = new MockFilterManager();
        logProcessor = new MockLogProcessor();

        // Mocks for others
        const logger = Logger.getInstance();
        const highlightService = new HighlightService(filterManager, logger);
        const sourceMapService = SourceMapService.getInstance();

        // Mock TreeViews (casted as any to avoid complex mocking of TreeView)
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
            false // Do not register commands
        );

        // Open a dummy document so applyFilter proceeds
        const doc = await vscode.workspace.openTextDocument({ content: 'test log\nERROR test', language: 'log' });
        await vscode.window.showTextDocument(doc);
    });

    test('Apply Word Filter (Global) - Group Enablement', async () => {
        // Scenario:
        // Group 1: Disabled, Contains Enabled Item
        // Group 2: Enabled, Contains Disabled Item (no enabled items)
        // Group 3: Enabled, Contains Enabled Item
        // Expected:
        // Group 1 is IGNORED (because Group is disabled)
        // Group 2 is IGNORED (because no enabled items - Strict Item)
        // Group 3 is PROCESSED

        const g1 = filterManager.addGroup('Group 1', false)!;
        // Group 1 Disabled by default? verify addGroup(..., false) -> isRegex=false. isEnabled default false?
        // Let's explicitly set states.
        if (g1.isEnabled) { filterManager.toggleGroup(g1.id); }
        assert.strictEqual(g1.isEnabled, false, 'Group 1 should be disabled');
        filterManager.addFilter(g1.id, 'Item 1', 'include'); // Default enabled

        const g2 = filterManager.addGroup('Group 2', false)!;
        if (!g2.isEnabled) { filterManager.toggleGroup(g2.id); } // Enable Group 2
        const f2 = filterManager.addFilter(g2.id, 'Item 2', 'include')!;
        filterManager.toggleFilter(g2.id, f2.id); // Disable Item 2

        const g3 = filterManager.addGroup('Group 3', false)!;
        if (!g3.isEnabled) { filterManager.toggleGroup(g3.id); } // Enable Group 3
        filterManager.addFilter(g3.id, 'Item 3', 'include'); // Default enabled

        // Access private method by casting to any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).applyFilter('word');

        const processed = logProcessor.lastProcessedGroups;

        // Verification
        // Group 1: Ignored (Disabled Group)
        const g1Processed = processed.find(g => g.id === g1.id);
        assert.strictEqual(g1Processed, undefined, 'Group 1 should be ignored because group is disabled');

        // Group 2: Ignored (No Enabled Items)
        const g2Processed = processed.find(g => g.id === g2.id);
        assert.strictEqual(g2Processed, undefined, 'Group 2 should be ignored because it has no enabled items');

        // Group 3: Processed
        const g3Processed = processed.find(g => g.id === g3.id);
        assert.ok(g3Processed, 'Group 3 should be processed');
    });

    test('Run Filter Group (Specific) - Runs ONLY the target group', async () => {
        // Scenario:
        // Group 1: Enabled, Item Enabled
        // Group 2: Enabled, Item Enabled
        // Target: Group 1
        // Expected: Only Group 1 is processed.

        const g1 = filterManager.addGroup('Group 1', false)!;
        filterManager.toggleGroup(g1.id);
        filterManager.addFilter(g1.id, 'Item 1', 'include');

        const g2 = filterManager.addGroup('Group 2', false)!;
        filterManager.toggleGroup(g2.id);
        filterManager.addFilter(g2.id, 'Item 2', 'include');

        // Execute for Group 1 only
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (commandManager as any).applyFilter('word', g1);

        const processed = logProcessor.lastProcessedGroups;

        assert.strictEqual(processed.length, 1, 'Should process exactly 1 group');
        assert.strictEqual(processed[0].id, g1.id, 'Should process Group 1');
    });

    test('Apply Word Filter (Global) - Warning Check', async () => {
        // Scenario:
        // No groups added.
        // Expected: Warning message "No active word groups selected."

        // Mock vscode.window.showWarningMessage
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
        let capturedMessage: string | undefined;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (vscode.window as any).showWarningMessage = async (message: string, ..._items: any[]) => {
            capturedMessage = message;
            return undefined;
        };

        try {
            // Apply filter with no groups
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (commandManager as any).applyFilter('word');

            assert.strictEqual(capturedMessage, 'No active word groups selected.');
        } finally {
            // Restore original method
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (vscode.window as any).showWarningMessage = originalShowWarningMessage;
        }
    });

    test('Apply Word Filter - Large File (70MB)', async function () {
        this.timeout(60000); // Give it enough time since it's a large file

        // Create ~70MB temp file
        const tmpDir = os.tmpdir();
        const tempFilePath = path.join(tmpDir, `large_test_file_${Date.now()}.log`);

        // Write ~70MB of data, with only 10% containing 'ERROR' so the filtered result is < 10MB
        const infoLine = 'This is a standard log line with INFO level and normal text to fill up the required space.\n';
        const errorLine = 'This is a test log line with some ERROR and other keywords to make it somewhat realistic.\n';

        // 90 info lines + 10 error lines = 100 lines (10% error rate)
        const chunkBlock = infoLine.repeat(90) + errorLine.repeat(10);
        // 80 blocks * 100 lines = 8000 lines per write (~720KB)
        const chunk = chunkBlock.repeat(80);

        const stream = fs.createWriteStream(tempFilePath);
        for (let i = 0; i < 100; i++) {
            stream.write(chunk);
        }
        stream.end();

        await new Promise<void>(resolve => stream.on('finish', () => resolve()));

        // Mock EditorUtils to simulate an active tab with the 70MB file
        const originalResolveDocument = EditorUtils.resolveActiveDocument;
        const originalResolveUri = EditorUtils.resolveActiveUri;

        EditorUtils.resolveActiveDocument = async () => undefined;
        EditorUtils.resolveActiveUri = () => vscode.Uri.file(tempFilePath);

        try {
            const g1 = filterManager.addGroup('Large File Group', false)!;
            filterManager.toggleGroup(g1.id);
            filterManager.addFilter(g1.id, 'ERROR', 'include');

            // To verify actual matched line counts, use a real LogProcessor instead of the MockLogProcessor
            const realLogProcessor = new LogProcessor();
            let actualMatched = 0;
            let actualProcessed = 0;
            const originalProcessFile = realLogProcessor.processFile.bind(realLogProcessor);

            realLogProcessor.processFile = async (filePath: string, activeGroups: FilterGroup[], options?: { prependLineNumbers?: boolean; totalLineCount?: number; originalPath?: string; }) => {
                const result = await originalProcessFile(filePath, activeGroups, options);
                actualMatched = result.matched;
                actualProcessed = result.processed;
                return result;
            };

            const testCommandManager = new FilterExecutionCommandManager(
                mockContext,
                filterManager,
                new HighlightService(filterManager, Logger.getInstance()),
                realLogProcessor,
                Logger.getInstance(),
                SourceMapService.getInstance(),
                {} as vscode.TreeView<FilterGroup | FilterItem>,
                {} as vscode.TreeView<FilterGroup | FilterItem>,
                false
            );

            // Execute apply filter
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (testCommandManager as any).applyFilter('word');

            assert.strictEqual(actualProcessed, 800000, 'Should process exactly 800,000 lines for the large file');
            assert.strictEqual(actualMatched, 80000, 'Should match exactly 80,000 lines containing ERROR');
        } finally {
            // Restore mocks
            EditorUtils.resolveActiveDocument = originalResolveDocument;
            EditorUtils.resolveActiveUri = originalResolveUri;

            // Cleanup
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }
    });
});
