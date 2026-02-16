
import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowManager } from '../../services/WorkflowManager';
import { ProfileManager } from '../../services/ProfileManager';
import { LogProcessor } from '../../services/LogProcessor';
import { Logger } from '../../services/Logger';
import { HighlightService } from '../../services/HighlightService';
import { FilterGroup, FilterType } from '../../models/Filter';
import { Workflow } from '../../models/Workflow';

suite('Workflow Pipeline Tests', () => {
    let workflowManager: WorkflowManager;
    let profileManager: ProfileManager;
    let logProcessor: LogProcessor;
    let logger: Logger;
    let highlightService: HighlightService;
    let context: vscode.ExtensionContext;

    // Mock Data
    const mockFilter1 = { id: 'f1', keyword: 'filter1', isEnabled: true, type: 'include' as FilterType };
    const mockFilter2 = { id: 'f2', keyword: 'filter2', isEnabled: true, type: 'include' as FilterType };
    const mockFilter3 = { id: 'f3', keyword: 'filter3', isEnabled: true, type: 'include' as FilterType };
    const mockFilter4 = { id: 'f4', keyword: 'filter4', isEnabled: true, type: 'include' as FilterType };
    const mockFilter5 = { id: 'f5', keyword: 'filter5', isEnabled: true, type: 'include' as FilterType };
    const mockFilter20 = { id: 'f20', keyword: 'filter20', isEnabled: true, type: 'include' as FilterType };
    const mockFilter40 = { id: 'f40', keyword: 'filter40', isEnabled: true, type: 'include' as FilterType };

    setup(() => {
        // Mock Context
        context = {
            globalState: {
                get: (_key: string) => undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                update: (_key: string, _value: any) => Promise.resolve(),
            },
            subscriptions: [],
            extensionUri: vscode.Uri.file('/tmp'),
            extension: { packageJSON: { version: '1.0.0' } }
        } as unknown as vscode.ExtensionContext;

        logger = { info: (_s: string) => { }, error: (_s: string) => { }, warn: (_s: string) => { } } as unknown as Logger;
        highlightService = { registerDocumentFilters: () => { } } as unknown as HighlightService;

        // Mock ProfileManager
        profileManager = new ProfileManager(context);
        profileManager.getProfileNames = () => ['Default Profile', 'Profile1', 'Profile2', 'Profile3', 'Profile1_v2', 'Profile3_v2'];
        profileManager.getProfileGroups = async (name: string) => {
            if (name === 'Profile1') { return [{ id: 'g1', name: 'g1', filters: [mockFilter1, mockFilter2] } as FilterGroup]; }
            if (name === 'Profile2') { return [{ id: 'g2', name: 'g2', filters: [mockFilter3] } as FilterGroup]; }
            if (name === 'Profile3') { return [{ id: 'g3', name: 'g3', filters: [mockFilter4, mockFilter5] } as FilterGroup]; }
            if (name === 'Profile1_v2') { return [{ id: 'g1', name: 'g1', filters: [mockFilter1, mockFilter20] } as FilterGroup]; }
            if (name === 'Profile3_v2') { return [{ id: 'g3', name: 'g3', filters: [mockFilter40, mockFilter5] } as FilterGroup]; }
            return [];
        };

        // Mock LogProcessor
        logProcessor = new LogProcessor();
        logProcessor.processFile = async (_inputPath, _groups, _options) => {
            // Mock output path
            return {
                outputPath: '/tmp/output.log',
                processed: 100,
                matched: 10,
                lineMapping: []
            };
        };

        const mockSourceMapService = {
            register: (_f: vscode.Uri, _s: vscode.Uri, _m: number[]) => { }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, mockSourceMapService as any);
    });

    test('Scenario 1: Sequential Execution (Root -> Child)', async () => {
        // Tree: Root (Seq) -> Child (Seq)
        // Root: Profile1 (f1, f2)
        // Child: Profile2 (f3) -> Child takes Root's Output as Input

        const workflow: Workflow = {
            id: 'seq1',
            name: 'Sequential Pipeline',
            steps: [
                { id: 'root', profileName: 'Profile1', executionMode: 'sequential' },
                { id: 'child', profileName: 'Profile2', executionMode: 'sequential', parentId: 'root' }
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;

        // Mock LogProcessor to track inputs
        const processedInputs: string[] = [];
        logProcessor.processFile = async (inputPath, groups, _options) => {
            processedInputs.push(inputPath);
            return {
                outputPath: `/tmp/output_${groups[0]?.name || 'unknown'}.log`,
                processed: 100,
                matched: 10,
                lineMapping: []
            };
        };

        await workflowManager.run('seq1', document);

        const result = workflowManager.getLastRunResult();
        assert.ok(result, 'Simulation result should exist');
        assert.strictEqual(result.steps.length, 2);

        // 1. Verify Execution Order
        // Expect Root first, then Child
        const rootStep = result.steps.find(s => s.profileName === 'Profile1');
        const childStep = result.steps.find(s => s.profileName === 'Profile2');
        assert.ok(rootStep, 'Root step missing');
        assert.ok(childStep, 'Child step missing');
        assert.ok(rootStep!.stepIndex < childStep!.stepIndex, 'Root should run before Child');

        // 2. Verify Filters (Sequential = Self Only)
        // Root (P1): f1, f2 + Child (P2): f3
        const rootFilters = rootStep!.effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        assert.deepStrictEqual(rootFilters, ['filter1', 'filter2', 'filter3'].sort(), 'Root should have P1+P2 filters');

        // Child (P2): f3 (No inheritance from Root, just itself)
        const childFilters = childStep!.effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        assert.deepStrictEqual(childFilters, ['filter3'].sort(), 'Child should have P2 filters (Sequential)');

        // 3. Verify Input File Flow (Tree Structure)
        // Root Input: /tmp/input.log
        // Child Input: Root's Output
        assert.strictEqual(processedInputs[0], '/tmp/input.log', 'Root should take original input');
        assert.strictEqual(processedInputs[1], rootStep!.outputFilePath, 'Child should take Root output as input');
    });

    test('Scenario 2: Cumulative Execution (Root -> Child -> GrandChild)', async () => {
        // Tree: Root (Cum) -> Child (Cum) -> GrandChild (Cum)
        // Root: P1. Cumulative = P1 + P2 + P3
        // Child: P2. Cumulative = P2 + P3
        // GrandChild: P3. Cumulative = P3

        const workflow: Workflow = {
            id: 'cum1',
            name: 'Cumulative Pipeline',
            steps: [
                { id: 'root', profileName: 'Profile1', executionMode: 'cumulative' },
                { id: 'child', profileName: 'Profile2', executionMode: 'cumulative', parentId: 'root' },
                { id: 'grandchild', profileName: 'Profile3', executionMode: 'cumulative', parentId: 'child' }
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;

        await workflowManager.run('cum1', document);

        const result = workflowManager.getLastRunResult();
        const rootStep = result!.steps.find(s => s.profileName === 'Profile1')!;
        const childStep = result!.steps.find(s => s.profileName === 'Profile2')!;
        const grandChildStep = result!.steps.find(s => s.profileName === 'Profile3')!;

        // Root (P1 + P2 + P3)
        // P1(f1,f2), P2(f3), P3(f4,f5)
        // With mergeGroups=true, they are all in one group
        const rootFilters = rootStep.effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        assert.deepStrictEqual(rootFilters, ['filter1', 'filter2', 'filter3', 'filter4', 'filter5'].sort());

        // Child (P2 + P3)
        const childFilters = childStep.effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        assert.deepStrictEqual(childFilters, ['filter3', 'filter4', 'filter5'].sort());

        // GrandChild (P3)
        const grandChildFilters = grandChildStep.effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        assert.deepStrictEqual(grandChildFilters, ['filter4', 'filter5'].sort());
    });

    test('Scenario 3: Mixed Execution (Root[Seq] -> ChildA[Cum], ChildB[Seq])', async () => {
        // Tree:
        //        Root (P1, Seq)
        //       /              \
        // ChildA (P2, Cum)    ChildB (P3, Seq)
        // (Has Desc)          (No Desc)

        // Root: P1
        // ChildA: P2 + (Descendants... none here actually, unless we add one) -> P2
        // Let's add GrandChildA to ChildA's branch to test accumulation.
        // ChildA (P2, Cum) -> GrandChildA (P3, Seq)

        // Root (P1, Seq): f1, f2
        // ChildA (P2, Cum): P2 + P3 (f3, f4, f5) - Takes Root Output
        // GrandChildA (P3, Seq): P3 (f4, f5) - Takes ChildA Output
        // ChildB (P3, Seq): P3 (f4, f5) - Takes Root Output (Split!)

        const workflow: Workflow = {
            id: 'mixed1',
            name: 'Mixed Tree',
            steps: [
                { id: 'root', profileName: 'Profile1', executionMode: 'sequential' },
                { id: 'childA', profileName: 'Profile2', executionMode: 'cumulative', parentId: 'root' },
                { id: 'grandChildA', profileName: 'Profile3', executionMode: 'sequential', parentId: 'childA' },
                { id: 'childB', profileName: 'Profile3', executionMode: 'sequential', parentId: 'root' }
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;

        // Mock LogProcessor to track inputs
        const processedDetails: { input: string, output: string, profile: string }[] = [];
        logProcessor.processFile = async (inputPath, groups, options) => {
            const profileName = (options?.mergeGroups && groups.length > 1) ? 'Merged Group' : (groups[0]?.name || 'unknown');
            const output = `/tmp/output_${Date.now()}_${profileName.replace(/\s+/g, '_')}.log`;
            processedDetails.push({ input: inputPath, output: output, profile: profileName });
            return {
                outputPath: output,
                processed: 100,
                matched: 10,
                lineMapping: []
            };
        };

        await workflowManager.run('mixed1', document);
        const result = workflowManager.getLastRunResult();

        // The result.steps is an array. We rely on the order or IDs if we could.
        // Topological sort ensures Root runs first. Children run after.

        // Get processed details by profile for easier verification
        // With mergeGroups=true, the profile name in `groups[0]?.name` will be 'Merged Group' for cumulative steps with multiple groups.
        // We need to identify steps by checks on input/output paths or existence.

        const rootExec = processedDetails.find(d => d.input === '/tmp/input.log'); // Root process the initial input

        // ChildA (P2+P3) -> "Merged Group"
        // ChildB (P3) -> "g3"
        // GrandChildA (P3) -> "g3"

        // Identify by input
        // Root Exec: Input=/tmp/input.log, Profile=g1
        // ChildA Exec: Input=Root.Output, Profile=Merged Group (Cum)
        // ChildB Exec: Input=Root.Output, Profile=g3 (Seq)
        // GrandChildA Exec: Input=ChildA.Output, Profile=g3 (Seq)

        const childADetails = processedDetails.find(d => d.input === rootExec?.output && d.profile === 'Merged Group');

        // ChildB shares Input with ChildA, but has profile 'g3'
        const childBDetails = processedDetails.find(d => d.input === rootExec?.output && d.profile === 'g3');

        const grandChildADetails = processedDetails.find(d => d.input === childADetails?.output && d.profile === 'g3');

        // 1. Verify Root
        assert.ok(rootExec);
        assert.strictEqual(rootExec.input, '/tmp/input.log', 'Root Input');

        // 2. Verify ChildA (Cum)
        assert.ok(childADetails, 'ChildA should execute (Merged Group)');
        assert.strictEqual(childADetails.input, rootExec?.output, 'ChildA should take Root output');

        // P2 + P3
        const childAStepResult = result!.steps.find(s => s.outputFilePath === childADetails.output)!;
        const childAFilters = childAStepResult.effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        assert.deepStrictEqual(childAFilters, ['filter3', 'filter4', 'filter5'].sort());

        // 3. Verify GrandChildA (Seq)
        // Should take ChildA output
        assert.ok(grandChildADetails, 'GrandChildA should execute taking ChildA output');

        // 4. Verify ChildB (Seq)
        assert.ok(childBDetails, 'ChildB should execute taking Root Output');
        assert.strictEqual(childBDetails.input, rootExec?.output, 'ChildB Input match Root Output');

    });

    test('Scenario 4: Disconnected / Missing Parent Fallback', async () => {
        // If a step lists a parentId that doesn't exist, it should likely fall back to Root or Linear execution order
        // Implementation might put them at the end or as roots.
        const workflow: Workflow = {
            id: 'badtree',
            name: 'Bad Tree',
            steps: [
                { id: 's1', profileName: 'Profile1', executionMode: 'sequential', parentId: 'ghost' }, // Missing parent
                { id: 's2', profileName: 'Profile2', executionMode: 'sequential' } // Root
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;
        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;

        // Spy on logger
        logger.warn = (_msg) => { };

        // Should not crash
        await workflowManager.run('badtree', document);

        // s2 is root, runs first?
        // s1 has missing parent. The topological sort logic handling missing parents:
        // "Fallback: add remaining steps to end (linear)"
        const result = workflowManager.getLastRunResult()!;
        assert.strictEqual(result.steps.length, 2);

        // Since s1's parent is missing, it won't be in the initial queue or children search.
        // It will be added in the fallback loop.
        // s2 is a root (undefined parent), so it runs first?

        const firstStep = result.steps[0];
        const secondStep = result.steps[1];

        assert.strictEqual(firstStep.profileName, 'Profile1', 'S1 (orphan treated as root) runs first due to list order');
        assert.strictEqual(secondStep.profileName, 'Profile2', 'S2 (valid root) runs second');
    });

    test('Legacy Data Migration: Defaults executionMode to sequential', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const legacyWorkflow: any = {
            id: 'legacy1',
            name: 'Legacy Workflow',
            steps: [
                { id: 's1', profileName: 'profile1' } // Missing executionMode
            ]
        };

        // Override globalState.get to return legacy data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context.globalState.get = ((_key: string) => [legacyWorkflow]) as any;

        const mockSourceMap = { register: () => { } };

        // Re-initialize manager to trigger loadFromState
        const wm = new WorkflowManager(
            context,
            profileManager,
            logProcessor,
            logger,
            highlightService,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mockSourceMap as any
        );

        const workflows = wm.getWorkflows();
        const step = workflows[0].steps[0];
        assert.strictEqual(step.executionMode, 'sequential', 'Should default to sequential');
    });

    test('Visualization: DFS Order and Metadata', async () => {
        // Tree:
        // Root (Seq)
        //  -> ChildA (Cum)
        //      -> GrandChildA (Cum)
        //  -> ChildB (Seq)

        const workflow: Workflow = {
            id: 'viz1',
            name: 'Viz Test',
            steps: [
                { id: 'root', profileName: 'P1', executionMode: 'sequential' },
                { id: 'childA', profileName: 'P2', executionMode: 'cumulative', parentId: 'root' }, // Continuous
                { id: 'grandChildA', profileName: 'P3', executionMode: 'cumulative', parentId: 'childA' }, // Continuous
                { id: 'childB', profileName: 'P4', executionMode: 'sequential', parentId: 'root' } // Branch
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;
        // Mock workflows property directly since getWorkflowViewModels accesses it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (workflowManager as any).workflows = [workflow];

        const viewModels = await workflowManager.getWorkflowViewModels();
        const vm = viewModels[0];
        const profiles = vm.profiles;

        // Expected Order: Root -> ChildA -> GrandChildA -> ChildB
        assert.strictEqual(profiles.length, 4);
        assert.strictEqual(profiles[0].id, 'root');
        assert.strictEqual(profiles[1].id, 'childA');
        assert.strictEqual(profiles[2].id, 'grandChildA');
        assert.strictEqual(profiles[3].id, 'childB');

        // Check Metadata
        // Root (Depth 1)
        assert.strictEqual(profiles[0].depth, 1);
        assert.strictEqual(profiles[0].connectionType, 'branch');
        assert.strictEqual(profiles[0].isLastChild, true); // Root is last of roots (length 1)

        // ChildA (Depth 2)
        assert.strictEqual(profiles[1].depth, 2);
        assert.strictEqual(profiles[1].connectionType, 'continuous', 'Cumulative child should be continuous');
        assert.strictEqual(profiles[1].isLastChild, false); // Has sibling ChildB

        // GrandChildA (Depth 3)
        assert.strictEqual(profiles[2].depth, 3);
        assert.strictEqual(profiles[2].connectionType, 'continuous', 'Cumulative child of cumulative');
        assert.strictEqual(profiles[2].isLastChild, true); // Only child

        // ChildB (Depth 2)
        assert.strictEqual(profiles[3].depth, 2);
        assert.strictEqual(profiles[3].connectionType, 'branch', 'Sequential child should be branch');
        assert.strictEqual(profiles[3].isLastChild, true); // Last child of root
    });

});
