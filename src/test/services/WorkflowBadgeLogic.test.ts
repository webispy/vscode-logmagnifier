import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowManager } from '../../services/WorkflowManager';
import { ProfileManager } from '../../services/ProfileManager';
import { LogProcessor } from '../../services/LogProcessor';
import { Logger } from '../../services/Logger';
import { HighlightService } from '../../services/HighlightService';
import { Workflow } from '../../models/Workflow';
import { Constants } from '../../constants';
import { SourceMapService } from '../../services/SourceMapService';

suite('Workflow Badge Logic Test Suite', () => {
    let workflowManager: WorkflowManager;
    let context: vscode.ExtensionContext;
    let logProcessor: LogProcessor;
    let profileManager: ProfileManager;
    let logger: Logger;
    let highlightService: HighlightService;
    let sourceMapService: SourceMapService;

    setup(() => {
        context = {
            globalState: {
                get: (_key: string) => undefined,
                update: (_key: string, _value: unknown) => Promise.resolve(),
            },
            subscriptions: [],
            extensionUri: vscode.Uri.file('/tmp'),
            extension: { packageJSON: { version: '1.0.0' } }
        } as unknown as vscode.ExtensionContext;

        logger = { info: () => { }, error: () => { }, warn: () => { }, debug: () => { } } as unknown as Logger;
        profileManager = {
            getProfileGroups: async () => [],
            getProfileNames: () => [],
            loadProfile: async () => { },
            onDidChangeProfile: (() => { return { dispose: () => { } }; }) as unknown as vscode.Event<void>
        } as unknown as ProfileManager;

        logProcessor = new LogProcessor();
        logProcessor.processFile = async () => ({
            outputPath: '/tmp/output.log',
            processed: 10,
            matched: 5,
            lineMapping: []
        });

        highlightService = { registerDocumentFilters: () => { } } as unknown as HighlightService;
        sourceMapService = { register: () => { } } as unknown as SourceMapService;

        workflowManager = new WorkflowManager(
            context,
            profileManager,
            logProcessor,
            logger,
            highlightService,
            sourceMapService
        );
    });

    test('Badge visibility logic based on execution state', async () => {
        const workflowA: Workflow = { id: 'wfA', name: 'Workflow A', steps: [{ id: 's1', profileName: 'P1' }] };
        const workflowB: Workflow = { id: 'wfB', name: 'Workflow B', steps: [{ id: 's1', profileName: 'P1' }] };

        // 1. Initial State: No results, badge should be hidden for both
        (workflowManager as unknown as { workflows: Workflow[] }).workflows = [workflowA, workflowB];
        let vms = await workflowManager.getWorkflowViewModels();
        assert.strictEqual(vms.length, 2);
        assert.strictEqual(vms.find(v => v.id === 'wfA')?.lastRunFile, undefined, 'A should have no badge');
        assert.strictEqual(vms.find(v => v.id === 'wfB')?.lastRunFile, undefined, 'B should have no badge');

        // 2. Run Workflow A: Only A should show badge
        const doc = { uri: vscode.Uri.file('/tmp/src.log'), lineCount: 10, isDirty: false, isUntitled: false, getText: () => '' } as unknown as vscode.TextDocument;
        await workflowManager.run('wfA', doc);

        vms = await workflowManager.getWorkflowViewModels();
        assert.ok(vms.find(v => v.id === 'wfA')?.lastRunFile, 'A should have badge');
        assert.strictEqual(vms.find(v => v.id === 'wfB')?.lastRunFile, undefined, 'B should still have no badge');

        // 3. Run Workflow B: Both should show badges (independent state)
        await workflowManager.run('wfB', doc);

        vms = await workflowManager.getWorkflowViewModels();
        assert.ok(vms.find(v => v.id === 'wfA')?.lastRunFile, 'A should keep badge');
        assert.ok(vms.find(v => v.id === 'wfB')?.lastRunFile, 'B should have badge');
    });

    test('Badge hides after reload (session-only)', async () => {
        const workflow: Workflow = {
            id: 'wf1',
            name: 'Workflow 1',
            steps: [{ id: 's1', profileName: 'P1' }],
            lastRunFile: '/tmp/last.log' // Persisted in state
        };

        context.globalState.get = (key: string) => {
            if (key === Constants.GlobalState.Workflows) { return [workflow]; }
            return undefined;
        };

        const newManager = new WorkflowManager(
            context,
            profileManager,
            logProcessor,
            logger,
            highlightService,
            sourceMapService
        );

        const vms = await newManager.getWorkflowViewModels();
        assert.strictEqual(vms.length, 1, 'Should have 1 workflow loaded');
        assert.strictEqual(vms[0].lastRunFile, undefined, 'Badge should be hidden on fresh load even if lastRunFile is in storage');
    });
});
