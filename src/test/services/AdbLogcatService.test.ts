import * as assert from 'assert';
import { AdbLogcatService } from '../../services/adb/AdbLogcatService';
import { AdbClient } from '../../services/adb/AdbClient';
import { AdbTargetAppService } from '../../services/adb/AdbTargetAppService';
import { Logger } from '../../services/Logger';
import { AdbDevice, LogPriority } from '../../models/AdbModels';
import * as cp from 'child_process';

suite('AdbLogcatService Test Suite', () => {
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

    test('createSession and getSession', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test Session', device);

        assert.ok(session.id);
        assert.strictEqual(session.name, 'Test Session');
        assert.strictEqual(session.device.id, 'device1');
        assert.strictEqual(session.isRunning, false);
        assert.strictEqual(session.useStartFromCurrentTime, true);

        const retrieved = service.getSession(session.id);
        assert.deepStrictEqual(retrieved, session);

        const all = service.getSessions();
        assert.strictEqual(all.length, 1);
    });

    test('removeSession', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test Session', device);

        service.removeSession(session.id);
        assert.strictEqual(service.getSessions().length, 0);
        assert.strictEqual(service.getSession(session.id), undefined);
    });

    test('tags management', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test Session', device);

        service.addTag(session.id, { id: 'tag1', name: 'TAG', priority: LogPriority.Debug, isEnabled: true });

        let tags = service.getSession(session.id)!.tags;
        assert.strictEqual(tags.length, 1);
        assert.strictEqual(tags[0].name, 'TAG');

        service.updateTag(session.id, { id: 'tag1', name: 'TAG2', priority: LogPriority.Info, isEnabled: false });
        tags = service.getSession(session.id)!.tags;
        assert.strictEqual(tags[0].name, 'TAG2');
        assert.strictEqual(tags[0].isEnabled, false);

        service.removeTag(session.id, 'tag1');
        tags = service.getSession(session.id)!.tags;
        assert.strictEqual(tags.length, 0);
    });

    test('toggleSessionTimeFilter', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        const session = service.createSession('Test Session', device);

        assert.strictEqual(session.useStartFromCurrentTime, true);
        service.toggleSessionTimeFilter(session.id);
        assert.strictEqual(session.useStartFromCurrentTime, false);
    });
});
