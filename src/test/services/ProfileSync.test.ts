import * as assert from 'assert';
import { FilterManager } from '../../services/FilterManager';
import { WorkflowManager } from '../../services/WorkflowManager';
import { ProfileManager } from '../../services/ProfileManager';
import { MockExtensionContext } from '../utils/Mocks';
import { LogProcessor } from '../../services/LogProcessor';
import { HighlightService } from '../../services/HighlightService';
import { Logger } from '../../services/Logger';

suite('Profile Sync Integration Test Suite', () => {
    let filterManager: FilterManager;
    let workflowManager: WorkflowManager;
    let profileManager: ProfileManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        filterManager = new FilterManager(mockContext);

        // IMPORTANT: Use the SAME instance
        profileManager = filterManager.profileManagerRef;

        const logProcessor = new LogProcessor();
        const logger = Logger.getInstance();
        const highlightService = new HighlightService(filterManager, logger);
        const sourceMapService = {
            mappings: new Map(),
            register: () => { },
            unregister: () => { }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        workflowManager = new WorkflowManager(
            mockContext,
            profileManager,
            logProcessor,
            logger,
            highlightService,
            sourceMapService
        );
    });

    teardown(() => {
        filterManager.dispose();
        workflowManager.dispose();
    });

    test('FilterManager updates when ProfileManager changes active profile', async () => {
        // 1. Create a profile with specific filters
        const profileName = 'Sync Test Profile';
        await profileManager.createProfile(profileName, [
            {
                id: 'g1',
                name: 'Sync Group',
                isEnabled: true,
                isRegex: false,
                isExpanded: true,
                filters: [
                    { id: 'f1', keyword: 'sync-keyword', type: 'include', isEnabled: true, isRegex: false }
                ]
            }
        ]);

        // 2. Initial state: Default
        assert.notStrictEqual(filterManager.getActiveProfile(), profileName);

        // 3. Trigger loadProfile via ProfileManager (mimicking WorkflowManager behavior)
        await profileManager.loadProfile(profileName);

        // 4. Wait for async listener in FilterManager to process
        await new Promise(resolve => setTimeout(resolve, 200));

        // 5. Verify FilterManager updated its groups
        const groups = filterManager.getGroups();
        const syncGroup = groups.find(g => g.name === 'Sync Group');

        assert.ok(syncGroup, 'FilterManager should have loaded the Sync Group');
        assert.strictEqual(syncGroup.filters[0].keyword, 'sync-keyword');
        assert.strictEqual(filterManager.getActiveProfile(), profileName);
    });
});
