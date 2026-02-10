
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

    test('Scenario 1: Pipeline 1 (P1, P2, P3)', async () => {
        const workflow: Workflow = {
            id: 'sim1',
            name: 'Pipeline1',
            steps: [
                { id: 's1', profileName: 'Profile1' },
                { id: 's2', profileName: 'Profile2' },
                { id: 's3', profileName: 'Profile3' }
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;

        await workflowManager.run('sim1', document);

        const result = workflowManager.getLastRunResult();
        assert.ok(result, 'Simulation result should exist');
        assert.strictEqual(result.steps.length, 3);

        const step0Filters = result.steps[0].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        const step1Filters = result.steps[1].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        const step2Filters = result.steps[2].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();

        console.log('Step 0 Filters:', step0Filters);
        console.log('Step 1 Filters:', step1Filters);
        console.log('Step 2 Filters:', step2Filters);

        // Assertion based on CUMULATIVE Logic (Look-Ahead)
        // Step 0: P1 + P2 + P3 (f1, f2, f3, f4, f5)
        assert.deepStrictEqual(step0Filters, ['filter1', 'filter2', 'filter3', 'filter4', 'filter5'].sort());

        // Step 1: P2 + P3 (f3, f4, f5)
        assert.deepStrictEqual(step1Filters, ['filter3', 'filter4', 'filter5'].sort());

        // Step 2: P3 (f4, f5)
        assert.deepStrictEqual(step2Filters, ['filter4', 'filter5'].sort());
    });

    test('Scenario 2: Pipeline 2 (P3, P2, P1)', async () => {
        const workflow: Workflow = {
            id: 'sim2',
            name: 'Pipeline2',
            steps: [
                { id: 's1', profileName: 'Profile3' },
                { id: 's2', profileName: 'Profile2' },
                { id: 's3', profileName: 'Profile1' }
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;

        await workflowManager.run('sim2', document);
        const result = workflowManager.getLastRunResult();
        assert.ok(result, 'Simulation result should exist');

        const step0Filters = result.steps[0].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        console.log('Scenario 2 - Step 0 Filters:', step0Filters);

        // Expected by Cumulative: P3 + P2 + P1 (f4, f5, f3, f1, f2)
        assert.deepStrictEqual(step0Filters, ['filter1', 'filter2', 'filter3', 'filter4', 'filter5'].sort());

        const step1Filters = result.steps[1].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        // Expected: P2 + P1 (f3, f1, f2)
        assert.deepStrictEqual(step1Filters, ['filter1', 'filter2', 'filter3'].sort());

        const step2Filters = result.steps[2].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        // Expected: P1 (f1, f2)
        assert.deepStrictEqual(step2Filters, ['filter1', 'filter2'].sort());
    });

    test('Scenario 3: Profile Reconfiguration (Sync)', async () => {
        // "5. Profile Reconfigure... 6. Mode On... 7. Execute"
        const workflow: Workflow = {
            id: 'sim3',
            name: 'PipelineReconfig',
            steps: [
                { id: 's1', profileName: 'Profile1_v2' }, // f1, f20
                { id: 's2', profileName: 'Profile3_v2' }  // f40, f5
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;
        await workflowManager.run('sim3', document);

        const result = workflowManager.getLastRunResult();
        assert.ok(result);

        const step0Filters = result.steps[0].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        // Expected cumulative: s1 + s2 = (f1, f20) + (f40, f5)
        assert.deepStrictEqual(step0Filters, ['filter1', 'filter20', 'filter40', 'filter5'].sort());

        const step1Filters = result.steps[1].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        // Expected cumulative: s2 = (f40, f5)
        assert.deepStrictEqual(step1Filters, ['filter40', 'filter5'].sort());
    });

    test('Scenario 4: Filter Group Overwrite Reproduction', async () => {
        // User Report:
        // [profille1] group: filter1 - hello, world
        // [profille2] group: filter1 - sun, dark
        // [profille3] group: filter1 - moon, sun

        const fHello = { id: 'fHello', keyword: 'hello', isEnabled: true, type: 'include' as FilterType };
        const fWorld = { id: 'fWorld', keyword: 'world', isEnabled: true, type: 'include' as FilterType };

        const fSun1 = { id: 'fSun1', keyword: 'sun', isEnabled: true, type: 'include' as FilterType };
        const fDark = { id: 'fDark', keyword: 'dark', isEnabled: true, type: 'include' as FilterType };

        const fMoon = { id: 'fMoon', keyword: 'moon', isEnabled: true, type: 'include' as FilterType };
        const fSun2 = { id: 'fSun2', keyword: 'sun', isEnabled: true, type: 'include' as FilterType };

        const groupID = 'g_filter1';
        const groupName = 'filter1';

        const originalGetProfileGroups = profileManager.getProfileGroups;
        profileManager.getProfileGroups = async (name: string) => {
            if (name === 'Profile1') { return [{ id: groupID, name: groupName, filters: [fHello, fWorld] } as FilterGroup]; }
            if (name === 'Profile2') { return [{ id: groupID, name: groupName, filters: [fSun1, fDark] } as FilterGroup]; }
            if (name === 'Profile3') { return [{ id: groupID, name: groupName, filters: [fMoon, fSun2] } as FilterGroup]; }
            return originalGetProfileGroups(name);
        };

        const workflow: Workflow = {
            id: 'sim4',
            name: 'PipelineOverwrite',
            steps: [
                { id: 's1', profileName: 'Profile1' },
                { id: 's2', profileName: 'Profile2' },
                { id: 's3', profileName: 'Profile3' }
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;
        await workflowManager.run('sim4', document);
        const result = workflowManager.getLastRunResult();
        assert.ok(result);

        // Step 0: Expect P1 + P2 + P3
        // hello, world, sun, dark, moon
        const step0Filters = result.steps[0].effectiveGroups.flatMap(g => g.filters).map(f => f.keyword).sort();
        console.log('Scenario 4 - Step 0 Filters:', step0Filters);

        // Deduplicate keywords for assertion (sun appears twice)
        const uniqueKeywords = [...new Set(step0Filters)];
        assert.deepStrictEqual(uniqueKeywords, ['dark', 'hello', 'moon', 'sun', 'world'].sort());

        // Ensure "hello" is present (proving P1 wasn't overwritten)
        assert.ok(uniqueKeywords.includes('hello'), 'Filter "hello" from Profile1 should be present');
    });

    test('Scenario 5: UI Sync Verification (activateStep loads profile)', async () => {
        // Arrange
        let loadedProfileName = '';
        profileManager.loadProfile = async (name: string) => {
            loadedProfileName = name;
            return undefined;
        };

        const workflow: Workflow = {
            id: 'sim5',
            name: 'PipelineUI',
            steps: [
                { id: 's1', profileName: 'Profile1' }
            ]
        };
        workflowManager.getWorkflow = (_id: string) => workflow;

        const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;

        // Act 1: Run to generate cached result
        await workflowManager.run('sim5', document); // This populates lastRunResult

        // Act 2: Activate Step (should trigger loadProfile -> UI Update)
        await workflowManager.activateStep('sim5', 's1');

        // Assert
        assert.strictEqual(loadedProfileName, 'Profile1', 'activateStep must call loadProfile to sync UI');
    });
});
