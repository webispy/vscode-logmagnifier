import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowManager } from '../../services/WorkflowManager';
import { ProfileManager } from '../../services/ProfileManager';
import { LogProcessor } from '../../services/LogProcessor';
import { Logger } from '../../services/Logger';
import { HighlightService } from '../../services/HighlightService';
import { SourceMapService } from '../../services/SourceMapService';
import { WorkflowPackage } from '../../models/Workflow';
import { FilterType } from '../../models/Filter';

suite('Workflow Import/Export Test Suite', () => {
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
            extension: { packageJSON: { version: '1.2.3' } }
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

    suite('Export', () => {
        test('Should export comprehensive package with full filter data', async () => {
            // Setup a workflow with steps and profiles
            const filterGroups = [{
                id: 'g1',
                name: 'Group 1',
                isEnabled: true,
                isRegex: false,
                filters: [{ id: 'f1', keyword: 'error', type: 'include' as FilterType, isEnabled: true, color: '#ff0000' }]
            }];

            await profileManager.updateProfileData('Auth', filterGroups);

            const workflow = await workflowManager.createWorkflow('Test Workflow');
            await workflowManager.addProfileToWorkflow(workflow.id, 'Auth');

            const json = await workflowManager.exportWorkflow(workflow.id);
            assert.ok(json);

            const pkg = JSON.parse(json!) as WorkflowPackage;

            // Format Validation
            assert.strictEqual(pkg.version, '1.2.3');
            assert.strictEqual(pkg.workflow.name, 'Test Workflow');
            assert.strictEqual(pkg.workflow.steps.length, 1);
            assert.strictEqual(pkg.workflow.steps[0].profileName, 'Auth');

            // Bundling Validation
            assert.strictEqual(pkg.profiles.length, 1);
            assert.strictEqual(pkg.profiles[0].name, 'Auth');
            assert.deepStrictEqual(pkg.profiles[0].groups, filterGroups);
        });

        test('Should migrate legacy profileNames to steps during export', async () => {
            const legacyWorkflow = {
                id: 'legacy_id',
                name: 'Legacy Workflow',
                profileNames: ['ProfileA']
            };

            globalStateData['logmagnifier.workflows'] = [legacyWorkflow];
            // Re-init to load legacy data
            workflowManager = new WorkflowManager(context, profileManager, logProcessor, logger, highlightService, sourceMapService);

            const json = await workflowManager.exportWorkflow('legacy_id');
            const pkg = JSON.parse(json!) as WorkflowPackage;

            assert.ok(pkg.workflow.steps);
            assert.strictEqual(pkg.workflow.steps.length, 1);
            assert.strictEqual(pkg.workflow.steps[0].profileName, 'ProfileA');
        });
    });

    suite('Import', () => {
        test('Path 1: No profile name conflicts', async () => {
            const pkg: WorkflowPackage = {
                version: '1.0.0',
                workflow: { id: 'wf1', name: 'New Workflow', steps: [{ id: 's1', profileName: 'NewProfile' }] },
                profiles: [{ name: 'NewProfile', groups: [] }]
            };

            const success = await workflowManager.importWorkflow(JSON.stringify(pkg));
            assert.strictEqual(success, true);

            const importedWf = workflowManager.getWorkflow('wf1');
            assert.ok(importedWf);
            assert.strictEqual(importedWf.steps[0].profileName, 'NewProfile');

            const profileNames = profileManager.getProfileNames();
            assert.ok(profileNames.includes('NewProfile'));
        });

        test('Path 2: Conflict resolved by "Overwrite"', async () => {
            // Setup existing profile
            await profileManager.updateProfileData('Existing', [{ id: 'old', name: 'Old', isRegex: false, isEnabled: true, filters: [] }]);

            const pkg: WorkflowPackage = {
                version: '1.0.0',
                workflow: { id: 'wf2', name: 'Overwrite Workflow', steps: [{ id: 's1', profileName: 'Existing' }] },
                profiles: [{ name: 'Existing', groups: [{ id: 'new', name: 'New', isRegex: true, isEnabled: true, filters: [] }] }]
            };

            // Resolver returns 'overwrite'
            const success = await workflowManager.importWorkflow(JSON.stringify(pkg), async () => 'overwrite');
            assert.strictEqual(success, true);

            const groups = await profileManager.getProfileGroups('Existing');
            assert.strictEqual(groups![0].id, 'new', 'Profile should be overwritten');
        });

        test('Path 3: Conflict resolved by "Create Copy" (Profile name "Profile (#)" + Pipeline Sync)', async () => {
            // Setup existing profile
            await profileManager.updateProfileData('Conflict', [{ id: 'orig', name: 'Original', isRegex: false, isEnabled: true, filters: [] }]);

            // Setup existing workflow with same name to test suffix
            await workflowManager.createWorkflow('Sync Workflow');

            const pkg: WorkflowPackage = {
                version: '1.0.0',
                workflow: { id: 'wf3', name: 'Sync Workflow', steps: [{ id: 's1', profileName: 'Conflict' }] },
                profiles: [{ name: 'Conflict', groups: [{ id: 'imported', name: 'Imported', isRegex: false, isEnabled: true, filters: [] }] }]
            };

            // Resolver returns 'copy'
            const success = await workflowManager.importWorkflow(JSON.stringify(pkg), async () => 'copy');
            assert.strictEqual(success, true);

            // 1. Verify Profile Renaming
            const profileNames = profileManager.getProfileNames();
            assert.ok(profileNames.includes('Conflict'), 'Original should remain');
            assert.ok(profileNames.includes('Conflict (1)'), 'Copy should be created with (#) format');

            // 2. Verify Pipeline Sync
            const workflows = workflowManager.getWorkflows();
            const importedWf = workflows.find(w => w.name === 'Sync Workflow (1)');
            assert.ok(importedWf, 'Imported workflow should be found as "Sync Workflow (1)" due to name collision');
            assert.strictEqual(importedWf.steps[0].profileName, 'Conflict (1)', 'Workflow step should be updated to point to the renamed profile');

            // 3. Verify Content
            const groups = await profileManager.getProfileGroups('Conflict (1)');
            assert.strictEqual(groups![0].id, 'imported');
        });

        test('Verify multiple copies increment correctly', async () => {
            await profileManager.updateProfileData('Base', []);
            await profileManager.updateProfileData('Base (1)', []);

            const pkg: WorkflowPackage = {
                version: '1.0.0',
                workflow: { id: 'wf4', name: 'Multi Copy', steps: [{ id: 's1', profileName: 'Base' }] },
                profiles: [{ name: 'Base', groups: [] }]
            };

            await workflowManager.importWorkflow(JSON.stringify(pkg), async () => 'copy');

            const profileNames = profileManager.getProfileNames();
            assert.ok(profileNames.includes('Base (2)'), 'Should increment to (2) if (1) exists');
        });

        test('Atomic Execution: Abort on "cancel"', async () => {
            await profileManager.updateProfileData('AbortMe', []);

            const pkg: WorkflowPackage = {
                version: '1.0.0',
                workflow: { id: 'wf5', name: 'Abort Workflow', steps: [{ id: 's1', profileName: 'AbortMe' }] },
                profiles: [{ name: 'AbortMe', groups: [] }]
            };

            const success = await workflowManager.importWorkflow(JSON.stringify(pkg), async () => 'cancel');
            assert.strictEqual(success, false);

            const importedWf = workflowManager.getWorkflow('wf5');
            assert.strictEqual(importedWf, undefined, 'Workflow should not be saved if cancelled');
        });
    });
});
