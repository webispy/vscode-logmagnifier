import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowManager } from '../../services/WorkflowManager';
import { ProfileManager } from '../../services/ProfileManager';
import { LogProcessor } from '../../services/LogProcessor';
import { Logger } from '../../services/Logger';
import { HighlightService } from '../../services/HighlightService';
import { SourceMapService } from '../../services/SourceMapService';

suite('Workflow Missing Profile Test Suite', () => {
    let workflowManager: WorkflowManager;
    let profileManager: ProfileManager;
    let logProcessor: LogProcessor;
    let logger: Logger;
    let highlightService: HighlightService;
    let sourceMapService: SourceMapService;
    let context: vscode.ExtensionContext;
    let globalStateData: Record<string, unknown> = {};

    setup(() => {
        globalStateData = {};
        context = {
            globalState: {
                get: (key: string) => globalStateData[key],
                update: (key: string, value: unknown) => { globalStateData[key] = value; return Promise.resolve(); },
            },
            subscriptions: [],
            extensionUri: vscode.Uri.file('/tmp'),
        } as unknown as vscode.ExtensionContext;

        logger = { info: () => { }, error: () => { }, warn: () => { }, debug: () => { } } as unknown as Logger;
        highlightService = { registerDocumentFilters: () => { } } as unknown as HighlightService;
        profileManager = new ProfileManager(context);
        logProcessor = new LogProcessor();
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

    test('Detection: getWorkflowViewModels should set isMissing flag for non-existent profiles', async () => {
        // Create workflow with a step pointing to a profile that DOES NOT exist
        const workflow = await workflowManager.createWorkflow('Test Missing');
        await workflowManager.addProfileToWorkflow(workflow.id, 'NonExistentProfile');

        const vms = await workflowManager.getWorkflowViewModels();
        const wfVm = vms.find(v => v.id === workflow.id);

        assert.ok(wfVm);
        assert.strictEqual(wfVm.name, 'Test Missing');
        assert.strictEqual(wfVm.profiles.length, 1);
        assert.strictEqual(wfVm.profiles[0].name, 'NonExistentProfile');
        assert.strictEqual(wfVm.profiles[0].isMissing, true, 'Profile should be marked as missing');
    });

    test('Execution: run should continue and log error when encountering missing profile', async () => {
        await profileManager.updateProfileData('Exist', []);

        const workflow = await workflowManager.createWorkflow('Mixed Workflow');
        await workflowManager.addProfileToWorkflow(workflow.id, 'Exist');
        await workflowManager.addProfileToWorkflow(workflow.id, 'MissingOne');
        await workflowManager.addProfileToWorkflow(workflow.id, 'ExistToo');
        await profileManager.updateProfileData('ExistToo', []);

        const document = {
            uri: vscode.Uri.file('/tmp/test.log'),
            lineCount: 1,
            getText: () => 'test',
            fileName: '/tmp/test.log'
        } as unknown as vscode.TextDocument;

        // Mock logProcessor.processFile to track calls
        let processCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (logProcessor as any).processFile = async () => {
            processCount++;
            return {
                outputPath: '/tmp/out.log',
                matched: 1, // Ensure matched > 0 so currentFilePath updates (though it updates always now)
                processed: 1,
                lineMapping: []
            };
        };

        await workflowManager.run(workflow.id, document);

        assert.strictEqual(processCount, 2, 'Should have processed only the 2 existing profiles');
    });
});
