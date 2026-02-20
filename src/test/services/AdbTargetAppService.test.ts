import * as assert from 'assert';
import { AdbTargetAppService } from '../../services/adb/AdbTargetAppService';
import { AdbClient } from '../../services/adb/AdbClient';
import { Logger } from '../../services/Logger';
import { AdbDevice } from '../../models/AdbModels';

suite('AdbTargetAppService Test Suite', () => {
    let service: AdbTargetAppService;
    let logger: Logger;
    let client: AdbClient;

    setup(() => {
        logger = {
            info: () => { },
            warn: () => { },
            error: () => { },
            dispose: () => { }
        } as unknown as Logger;

        client = {
            getAdbPath: () => 'adb',
            execAdb: async () => ''
        } as unknown as AdbClient;

        service = new AdbTargetAppService(logger, client);
    });

    test('manage target app map', () => {
        const device: AdbDevice = { id: 'device1', type: 'device' };
        service.setTargetApp(device, 'com.example.app');
        assert.strictEqual(service.getTargetApp('device1'), 'com.example.app');
        assert.strictEqual(device.targetApp, 'com.example.app');
    });

    test('getInstalledPackages', async () => {
        client.execAdb = async (args) => {
            if (args.includes('pm')) {
                return 'package:com.android.calculator\npackage:com.example.app\nrandom extra line';
            }
            return '';
        };

        const packages = await service.getInstalledPackages('device1');
        assert.deepStrictEqual(packages, ['com.android.calculator', 'com.example.app']);
    });

    test('getRunningApps parses ps output', async () => {
        client.execAdb = async (args) => {
            if (args.includes('ps')) {
                return `USER PID PPID VSIZE RSS WCHAN PC NAME
u0_a100 1234 567 10000 2000 0 0 com.example.app
root 1 0 1000 100 0 0 init`;
            }
            return '';
        };

        const apps = await service.getRunningApps('device1');
        assert.strictEqual(apps.has('com.example.app'), true);
        assert.strictEqual(apps.has('init'), false); // no dot
    });

    test('getAppPid handles pidof', async () => {
        client.execAdb = async (args) => {
            if (args.includes('pidof')) {
                return '12345\n';
            }
            return '';
        };

        const pid = await service.getAppPid('device1', 'com.example.app');
        assert.strictEqual(pid, '12345');
    });

    test('app lifecycle helpers', async () => {
        let lastArgs: string[] = [];
        client.execAdb = async (args) => {
            lastArgs = args as string[];
            if (args.includes('uninstall')) {return 'Success';}
            if (args.includes('clear')) {return 'Success';}
            if (args.includes('monkey')) {return 'Events injected: 100';}
            return '';
        };

        const uninstalled = await service.uninstallApp('dev1', 'com.app');
        assert.ok(uninstalled);
        assert.ok(lastArgs.includes('uninstall'));

        const cleared = await service.clearAppStorage('dev1', 'com.app');
        assert.ok(cleared);
        assert.ok(lastArgs.includes('clear'));

        const cached = await service.clearAppCache('dev1', 'com.app');
        assert.ok(cached);
        assert.ok(lastArgs.includes('run-as'));

        const launched = await service.launchApp('dev1', 'com.app');
        assert.ok(launched);
        assert.ok(lastArgs.includes('monkey'));
    });
});
