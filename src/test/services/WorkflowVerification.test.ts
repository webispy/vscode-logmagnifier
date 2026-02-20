import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkflowManager } from '../../services/WorkflowManager';
import { ProfileManager } from '../../services/ProfileManager';
import { LogProcessor } from '../../services/LogProcessor';

function createFilter(pattern: string) {
    return {
        id: pattern,
        keyword: pattern,
        pattern: pattern,
        type: 'include' as const,
        isEnabled: true
    };
}

suite('Workflow Final Verification', () => {
    let workflowManager: WorkflowManager;
    let profileManager: ProfileManager;
    let logProcessor: LogProcessor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let logger: any; // Mock Logger
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let highlightService: any; // Mock HighlightService
    let context: vscode.ExtensionContext;
    let openedFiles: string[] = [];

    setup(() => {
        openedFiles = [];
        // Mock Context
        context = {
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            extensionUri: vscode.Uri.file('/mock/extension'),
            asAbsolutePath: (p: string) => p,
            extensionPath: '/mock/extension'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        // Mock Logger
        logger = {
            info: (msg: string) => console.log(`[Logger] ${msg}`),
            error: (msg: string) => console.error(`[Logger Error] ${msg}`),
            warn: (msg: string) => console.warn(`[Logger Warn] ${msg}`),
            debug: (msg: string) => console.log(`[Logger Debug] ${msg}`)
        };

        // Mock HighlightService
        highlightService = {
            updateDecorations: () => { },
            registerDocumentFilters: () => { }
        };

        // Mock ProfileManager
        profileManager = new ProfileManager(context);
        profileManager.getProfileNames = () => ['Default Profile', 'profile1', 'profile2', 'profile3'];
        profileManager.getProfileGroups = async (name: string) => {
            const filters = [];
            if (name === 'profile1') {
                filters.push(createFilter('hello'), createFilter('world'));
            } else if (name === 'profile2') {
                filters.push(createFilter('sun'), createFilter('dark'));
            } else if (name === 'profile3') {
                filters.push(createFilter('moon'), createFilter('star'));
            }

            if (filters.length > 0) {
                return [{
                    id: 'group1',
                    name: 'group1',
                    filters: filters,
                    isEnabled: true,
                    isExpanded: true
                }];
            }
            return [];
        };

        // REAL LogProcessor
        logProcessor = new LogProcessor();

        // Mock SourceMapService
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const registeredMappings: any[] = [];
        const mockSourceMapService = {
            register: (filteredUri: vscode.Uri, sourceUri: vscode.Uri, lineMapping: number[]) => {
                registeredMappings.push({
                    filtered: filteredUri.fsPath,
                    source: sourceUri.fsPath,
                    mapLen: lineMapping.length
                });
            }
        };

        // Instantiate
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, mockSourceMapService as any);
        workflowManager.stepDelay = 0; // Skip UI delay in tests to avoid CI timeout

        // Mock openStepResult to skip heavy VS Code API calls
        // (vscode.workspace.fs.stat, openTextDocument, setTextDocumentLanguage)
        // that cause ~1.3s cold-start overhead in CI extension host
        workflowManager.openStepResult = async (step) => {
            openedFiles.push(step.outputFilePath);
        };

        // Expose registeredMappings for verification
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (workflowManager as any)._test_registeredMappings = registeredMappings;
    });

    test('3-Step Pipeline: Cumulative Filtering, Sequential Opening, and Chain Mapping', async () => {
        // --- PREPARE INPUT ---
        const inputContent = [
            "Say hello.",
            "See the world.",
            "Feel the sun.",
            "Fear the dark.",
            "Shine like the moon.",
            "Catch a falling star.",
            "Just noise."
        ].join('\n');

        const sim = {
            id: 'sim_final',
            name: 'Final Pipeline',
            steps: [
                { id: 's1', profileName: 'profile1', executionMode: 'cumulative' as const },
                { id: 's2', profileName: 'profile2', executionMode: 'cumulative' as const, parentId: 's1' },
                { id: 's3', profileName: 'profile3', executionMode: 'sequential' as const, parentId: 's2' }
            ]
        };

        workflowManager.getWorkflow = (_id: string) => sim;

        // Create a temporary file to act as the source
        const tempDir = os.tmpdir();
        const tempSourceFile = path.join(tempDir, `final_source_${Math.random().toString(36).substring(7)}.log`);
        fs.writeFileSync(tempSourceFile, inputContent);

        console.log(`[FINAL] Created temp source file: ${tempSourceFile}`);

        // Create a dummy document object
        const document = {
            uri: vscode.Uri.file(tempSourceFile),
            getText: () => inputContent,
            lineCount: 7,
            isUntitled: false
        } as vscode.TextDocument;

        // Verify document path before run
        console.log(`[FINAL] Document URI fsPath: ${document.uri.fsPath}`);
        assert.strictEqual(document.uri.fsPath, tempSourceFile, 'Document path mismatch before run');

        // --- EXECUTE ---
        const startTime = Date.now();
        await workflowManager.run('sim_final', document);
        const duration = Date.now() - startTime;

        // --- VERIFY RESULT ---
        const result = workflowManager.getLastRunResult();
        assert.ok(result, 'Simulation result should exist');
        assert.strictEqual(result.steps.length, 3, 'Should have 3 steps');

        const step1 = result.steps[0];
        const step2 = result.steps[1];
        const step3 = result.steps[2];

        // 1. Verify Cumulative Filtering
        const content1 = fs.readFileSync(step1.outputFilePath, 'utf8');
        assert.ok(content1.includes('hello'), 'Step 1 should have hello'); // P1
        assert.ok(!content1.includes('noise'), 'Step 1 should NOT have noise');

        const content2 = fs.readFileSync(step2.outputFilePath, 'utf8');
        assert.ok(!content2.includes('hello'), 'Step 2 should NOT have hello'); // Filtered out by P2 logic (only sun/dark kept from input?)
        // Wait, logic: P2 keeps sun/dark.
        // Input to Step 2 is Output of Step 1 (hello, world, sun, dark, moon, star)
        // P2 keeps sun, dark.
        // So hello is gone. Correct.
        assert.ok(content2.includes('sun'), 'Step 2 should have sun');

        const content3 = fs.readFileSync(step3.outputFilePath, 'utf8');
        assert.ok(!content3.includes('sun'), 'Step 3 should NOT have sun'); // P3 keeps moon/star
        assert.ok(content3.includes('moon'), 'Step 3 should have moon');

        // 2. Verify File Opening
        console.log('[FINAL] Opened files:', openedFiles);
        assert.strictEqual(openedFiles.length, 3, 'Should open 3 files');
        assert.strictEqual(openedFiles[0], step1.outputFilePath);
        assert.strictEqual(openedFiles[1], step2.outputFilePath);
        assert.strictEqual(openedFiles[2], step3.outputFilePath);

        // 3. Log Execution Duration
        console.log(`[FINAL] Execution Duration: ${duration}ms`);
        assert.ok(duration > 100, 'Execution too fast, delays missing?');

        // 4. Verify Source Mapping (N -> N-1)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mappings = (workflowManager as any)._test_registeredMappings;
        console.log('[FINAL] Mappings:', JSON.stringify(mappings, null, 2));

        assert.strictEqual(mappings.length, 3, 'Should have 3 mappings');

        // Step 1: Output -> Original
        assert.strictEqual(mappings[0].source, tempSourceFile, 'Step 1 Source Mapping Mismatch');
        assert.strictEqual(mappings[0].filtered, step1.outputFilePath);

        // Step 2: Output -> Step 1 Output
        assert.strictEqual(mappings[1].source, step1.outputFilePath, 'Step 2 Source Mapping Mismatch');
        assert.strictEqual(mappings[1].filtered, step2.outputFilePath);

        // Step 3: Output -> Step 2 Output
        assert.strictEqual(mappings[2].source, step2.outputFilePath, 'Step 3 Source Mapping Mismatch');
        assert.strictEqual(mappings[2].filtered, step3.outputFilePath);
    });
});
