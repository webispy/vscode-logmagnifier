
import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowManager } from '../../services/WorkflowManager';
import { ProfileManager } from '../../services/ProfileManager';
import { LogProcessor } from '../../services/LogProcessor';
import { Logger } from '../../services/Logger';
import { HighlightService } from '../../services/HighlightService';
import { SourceMapService } from '../../services/SourceMapService';

suite('Workflow Interaction Tests', () => {
    let workflowManager: WorkflowManager;
    let profileManager: ProfileManager;
    let logProcessor: LogProcessor;
    let logger: Logger;
    let highlightService: HighlightService;
    let context: vscode.ExtensionContext;
    let globalStateData: Record<string, unknown> = {};

    setup(() => {
        globalStateData = {};
        // Mock Context
        context = {
            globalState: {
                get: (key: string) => globalStateData[key],
                update: (key: string, value: unknown) => { globalStateData[key] = value; return Promise.resolve(); },
            },
            subscriptions: [],
            extensionUri: vscode.Uri.file('/tmp'),
            extension: { packageJSON: { version: '1.0.0' } }
        } as unknown as vscode.ExtensionContext;

        logger = { info: (_s: string) => { }, error: (_s: string) => { }, warn: (_s: string) => { } } as unknown as Logger;
        highlightService = { registerDocumentFilters: () => { } } as unknown as HighlightService;
        profileManager = new ProfileManager(context);
        logProcessor = new LogProcessor();
        const mockSourceMapService = {
            register: (_f: vscode.Uri, _s: vscode.Uri, _m: number[]) => { }
        };

        workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, mockSourceMapService as unknown as SourceMapService);

        // Mock existing workflows
        // const pb1: Workflow = { id: 'pb1', name: 'Workflow 1', steps: [] };
        // const pb2: Workflow = { id: 'pb2', name: 'Workflow 2', steps: [] };

        // Inject workflows (we can't easily mock the private property but we can mock loadFromState if we subclass,
        // OR we can just use the public API if exposed, or mock global state before init)
        // Since we already did `new WorkflowManager`, it loaded empty state.
        // Let's manually set the workflows via global state and re-init, or just assume we can use the manager logic without real workflows for this specific test
        // (handleWorkflowClick mostly cares about IDs and state, not valid workflow objects, except maybe for validation?)
        // The implementation doesn't validate existence for expansion logic implicitly.
    });

    test('Click Inactive Workflow -> Activates AND Expands', async () => {
        // Init with data in global state
        globalStateData['logmagnifier.workflows'] = [{ id: 'pb1', name: 'Workflow 1', steps: [] }];
        workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, { register: () => { } } as unknown as SourceMapService);

        // Initial state: No active workflow
        assert.strictEqual(workflowManager.getActiveWorkflow(), undefined);

        // Click 'pb1'
        await workflowManager.handleWorkflowClick('pb1');

        // Should be active
        assert.strictEqual(workflowManager.getActiveWorkflow(), 'pb1');

        // Check expansion state via ViewModel
        const vms = await workflowManager.getWorkflowViewModels();
        const vm1 = vms.find(p => p.id === 'pb1');
        assert.ok(vm1);
        assert.strictEqual(vm1?.isExpanded, true, 'Should BE expanded on first click (activation)');
    });

    test('Click Active Workflow WITH Active Step -> Switches to Workflow Focus, KEEP Expanded', async () => {
        // Init with data
        const pb = { id: 'pb1', name: 'Workflow 1', steps: [{ id: 'step1', name: 'Step 1', profileName: 'P1', executionMode: 'sequential' }] };
        globalStateData['logmagnifier.workflows'] = [pb];
        workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, { register: () => { } } as unknown as SourceMapService);

        // 1. Activate Workflow AND Expand it
        await workflowManager.setActiveWorkflow('pb1');
        await workflowManager.expandWorkflow('pb1');

        // 2. Activate Step
        await workflowManager.activateStep('pb1', 'step1');

        assert.strictEqual(workflowManager.getActiveWorkflow(), 'pb1');
        assert.strictEqual(workflowManager.getActiveStep(), 'step1');

        // 3. Click Workflow again
        await workflowManager.handleWorkflowClick('pb1');

        // Assertions
        assert.strictEqual(workflowManager.getActiveWorkflow(), 'pb1', 'Workflow should stay active');
        assert.strictEqual(workflowManager.getActiveStep(), undefined, 'Step should be cleared');

        const vms = await workflowManager.getWorkflowViewModels();
        const vm1 = vms.find(p => p.id === 'pb1');
        assert.strictEqual(vm1?.isExpanded, true, 'Workflow should REMAIN expanded');
    });

    test('Click Active Workflow -> Toggles Expansion', async () => {
        // Init with valid data
        globalStateData['logmagnifier.workflows'] = [{ id: 'pb1', name: 'Workflow 1', steps: [] }];
        workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, { register: () => { } } as unknown as SourceMapService);

        // 1. Activate -> Should Auto-Expand (New Logic)
        await workflowManager.handleWorkflowClick('pb1');
        assert.strictEqual(workflowManager.getActiveWorkflow(), 'pb1');

        let vms = await workflowManager.getWorkflowViewModels();
        assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, true, 'Should be expanded on activation');

        // 2. Click again (Active) -> Should Collapse
        await workflowManager.handleWorkflowClick('pb1');

        vms = await workflowManager.getWorkflowViewModels();
        assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, false, 'Should be collapsed after second click');

        // 3. Click again (Active) -> Should Expand
        await workflowManager.handleWorkflowClick('pb1');

        vms = await workflowManager.getWorkflowViewModels();
        assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, true, 'Should be expanded after third click');
    });

    test('Exclusive Activation / Expansion', async () => {
        // Init with 2 workflows
        globalStateData['logmagnifier.workflows'] = [
            { id: 'pb1', name: 'PB1', steps: [] },
            { id: 'pb2', name: 'PB2', steps: [] }
        ];
        workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, { register: () => { } } as unknown as SourceMapService);

        // Activate pb1 -> Should be active AND expanded (new logic)
        await workflowManager.handleWorkflowClick('pb1');
        assert.strictEqual(workflowManager.getActiveWorkflow(), 'pb1');
        let vms = await workflowManager.getWorkflowViewModels();
        assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, true, 'PB1 should auto-expand on activation');

        // Activate pb2 -> pb1 should collapse, pb2 should expand
        await workflowManager.handleWorkflowClick('pb2');
        assert.strictEqual(workflowManager.getActiveWorkflow(), 'pb2');

        vms = await workflowManager.getWorkflowViewModels();
        assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, false, 'PB1 should collapse');
        assert.strictEqual(vms.find(p => p.id === 'pb2')?.isExpanded, true, 'PB2 should expand');
    });

    suite('Auto-Expansion on Actions', () => {
        setup(async () => {
            globalStateData['logmagnifier.workflows'] = [{ id: 'pb1', name: 'PB1', steps: [] }];
            workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, { register: () => { } } as unknown as SourceMapService);
        });

        test('addProfileToWorkflow should expand the workflow', async () => {
            await workflowManager.collapseWorkflow('pb1');
            let vms = await workflowManager.getWorkflowViewModels();
            assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, false);

            await workflowManager.addProfileToWorkflow('pb1', 'SomeProfile');
            vms = await workflowManager.getWorkflowViewModels();
            assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, true, 'Should auto-expand after adding profile');
        });

        test('run should expand the workflow', async () => {
            await workflowManager.collapseWorkflow('pb1');
            let vms = await workflowManager.getWorkflowViewModels();
            assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, false);

            // Mock a step so run doesn't fail early
            const pb = workflowManager.getWorkflow('pb1');
            pb!.steps.push({ id: 's1', profileName: 'Profile1', executionMode: 'sequential' });

            const document = { uri: vscode.Uri.file('/tmp/input.log'), getText: () => '', lineCount: 100, isUntitled: false } as vscode.TextDocument;
            await workflowManager.run('pb1', document);

            vms = await workflowManager.getWorkflowViewModels();
            assert.strictEqual(vms.find(p => p.id === 'pb1')?.isExpanded, true, 'Should auto-expand after running');
        });

        test('duplicateWorkflow should expand the new workflow', async () => {
            const newSim = await workflowManager.duplicateWorkflow('pb1');
            assert.ok(newSim);

            const vms = await workflowManager.getWorkflowViewModels();
            assert.strictEqual(vms.find(p => p.id === newSim.id)?.isExpanded, true, 'New duplicate should be expanded');
        });

        test('importWorkflow should expand the imported workflow', async () => {
            const pkg = {
                version: '1.0.0',
                workflow: { id: 'imported1', name: 'Imported', steps: [] },
                profiles: []
            };
            await workflowManager.importWorkflow(JSON.stringify(pkg));

            const vms = await workflowManager.getWorkflowViewModels();
            assert.strictEqual(vms.find(p => p.id === 'imported1')?.isExpanded, true, 'Imported workflow should be expanded');
        });
    });
});
