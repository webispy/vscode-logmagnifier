import * as assert from 'assert';
import { AdbLogcatService } from '../../services/adb/AdbLogcatService';
import { AdbClient } from '../../services/adb/AdbClient';
import { AdbTargetAppService } from '../../services/adb/AdbTargetAppService';
import { Logger } from '../../services/Logger';
import { AdbDevice, LogPriority } from '../../models/AdbModels';
import * as cp from 'child_process';

suite('AdbLogcatService Buffer/Lifecycle Test Suite', () => {
    let service: AdbLogcatService;
    let logger: Logger;
    let client: AdbClient;
    let targetAppService: AdbTargetAppService;

    setup(() => {
        logger = {
            info: () => { },
            warn: () => { },
            error: () => { },
            dispose: () => { }
        } as unknown as Logger;

        client = {
            getAdbPath: () => 'adb',
            spawnAdb: () => ({
                stdout: { on: () => { } },
                stderr: { on: () => { } },
                on: () => { },
                kill: () => { }
            } as unknown as cp.ChildProcess)
        } as unknown as AdbClient;

        targetAppService = {
            getAppPid: async () => undefined
        } as unknown as AdbTargetAppService;

        service = new AdbLogcatService(logger, client, targetAppService);
    });

    teardown(() => {
        service.dispose();
    });

    test('stopSession kills process and marks session as not running', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test', device);

        // Simulate running state
        session.isRunning = true;

        service.stopSession(session.id);
        assert.strictEqual(session.isRunning, false, 'Session should be stopped');
    });

    test('stopSession on non-existent session does not throw', () => {
        assert.doesNotThrow(() => {
            service.stopSession('nonexistent-id');
        });
    });

    test('removeSession cleans up fully', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const s1 = service.createSession('Session 1', device);
        const s2 = service.createSession('Session 2', device);

        service.removeSession(s1.id);
        assert.strictEqual(service.getSessions().length, 1);
        assert.strictEqual(service.getSession(s1.id), undefined);
        assert.ok(service.getSession(s2.id));
    });

    test('addTag does not modify a running session', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test', device);
        session.isRunning = true;

        service.addTag(session.id, {
            id: 'tag1', name: 'TestTag', priority: LogPriority.Debug, isEnabled: true
        });

        assert.strictEqual(session.tags.length, 0, 'Should not add tag to running session');
    });

    test('removeTag does not modify a running session', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test', device);

        service.addTag(session.id, {
            id: 'tag1', name: 'TestTag', priority: LogPriority.Debug, isEnabled: true
        });
        assert.strictEqual(session.tags.length, 1);

        session.isRunning = true;
        service.removeTag(session.id, 'tag1');
        assert.strictEqual(session.tags.length, 1, 'Should not remove tag from running session');
    });

    test('toggleSessionTimeFilter does not modify a running session', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test', device);
        const original = session.useStartFromCurrentTime;

        session.isRunning = true;
        service.toggleSessionTimeFilter(session.id);
        assert.strictEqual(session.useStartFromCurrentTime, original, 'Should not toggle on running session');
    });

    test('dispose clears all timers and kills processes', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        service.createSession('S1', device);
        service.createSession('S2', device);

        // Should not throw
        assert.doesNotThrow(() => {
            service.dispose();
        });
    });

    test('multiple sessions can coexist', () => {
        const d1: AdbDevice = { id: 'device1', type: 'device' };
        const d2: AdbDevice = { id: 'device2', type: 'device' };

        const s1 = service.createSession('Session 1', d1);
        const s2 = service.createSession('Session 2', d2);

        assert.strictEqual(service.getSessions().length, 2);
        assert.notStrictEqual(s1.id, s2.id);
        assert.strictEqual(s1.device.id, 'device1');
        assert.strictEqual(s2.device.id, 'device2');
    });
});
