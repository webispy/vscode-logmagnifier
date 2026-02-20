import * as assert from 'assert';
import { AdbDeviceService } from '../../services/adb/AdbDeviceService';
import { AdbClient } from '../../services/adb/AdbClient';
import { Logger } from '../../services/Logger';

suite('AdbDeviceService Test Suite', () => {
    let adbClient: AdbClient;
    let logger: Logger;
    let service: AdbDeviceService;

    setup(() => {
        logger = {
            info: () => { },
            warn: () => { },
            error: () => { },
            dispose: () => { }
        } as unknown as Logger;

        adbClient = {
            getAdbPath: () => 'adb',
            execAdb: async () => '',
            spawnAdb: () => ({}) as unknown as import('child_process').ChildProcess
        } as unknown as AdbClient;

        service = new AdbDeviceService(logger, adbClient);
    });

    test('getDevices properly parses adb devices -l output', async () => {
        adbClient.execAdb = async (args: string[]) => {
            assert.deepStrictEqual(args, ['devices', '-l']);
            return 'List of devices attached\n911X01B93    device product:blueline model:Pixel_3 device:blueline transport_id:1\nemulator-5554 offline\ndead-device unauthorized\n';
        };

        const devices = await service.getDevices();
        assert.strictEqual(devices.length, 3);

        assert.strictEqual(devices[0].id, '911X01B93');
        assert.strictEqual(devices[0].type, 'device');
        assert.strictEqual(devices[0].model, 'Pixel_3');
        assert.strictEqual(devices[0].product, 'blueline');

        assert.strictEqual(devices[1].id, 'emulator-5554');
        assert.strictEqual(devices[1].type, 'offline');

        assert.strictEqual(devices[2].id, 'dead-device');
        assert.strictEqual(devices[2].type, 'unauthorized');
    });

    test('getDevices handles error gracefully', async () => {
        adbClient.execAdb = async () => { throw new Error('Timeout'); };

        const devices = await service.getDevices();
        assert.strictEqual(devices.length, 0);
    });

    test('captureScreenshot handles success', async () => {
        let pullCalled = false;
        adbClient.execAdb = async (args) => {
            if (args.includes('screencap')) { return ''; }
            if (args.includes('pull')) { pullCalled = true; return ''; }
            if (args.includes('rm')) { return ''; }
            return '';
        };

        const result = await service.captureScreenshot('dev-1', '/local/path.png');
        assert.strictEqual(result, true);
        assert.strictEqual(pullCalled, true);
    });

    test('getSystemInfo parses various dumped outputs', async () => {
        adbClient.execAdb = async (args) => {
            const cmd = args.join(' ');
            if (cmd.includes('getprop')) {
                return '[ro.product.model]: [Test_Model]\n[ro.build.version.release]: [11]\n[ro.build.version.sdk]: [30]\n[ro.product.cpu.abi]: [arm64-v8a]';
            }
            if (cmd.includes('wm size')) { return 'Physical size: 1080x2340'; }
            if (cmd.includes('wm density')) { return 'Physical density: 400'; }
            if (cmd.includes('dumpsys window displays')) { return 'mBounds=[0,0][1080,2340]'; }
            if (cmd.includes('dumpsys battery')) { return 'level: 85'; }
            if (cmd.includes('cat /proc/meminfo')) { return 'MemTotal: 4000000 kB\nMemAvailable: 2000000 kB'; }
            if (cmd.includes('ip route')) { return '192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.10'; }
            if (cmd.includes('curl')) { return '8.8.8.8'; }
            if (cmd.includes('df /data')) { return 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block 100000 50000 50000 50% /data'; }
            if (cmd.includes('android_id')) { return 'beef1234'; }
            return '';
        };

        const info = await service.getSystemInfo('device1');

        assert.ok(info.includes('Model: Test_Model'));
        assert.ok(info.includes('Android Version: 11 (SDK 30)'));
        assert.ok(info.includes('CPU ABI: arm64-v8a'));
        assert.ok(info.includes('Android ID: beef1234'));

        // Display
        assert.ok(info.includes('Resolution: 1080x2340, 400'));

        // Battery
        assert.ok(info.includes('Battery: 85%'));

        // Network
        assert.ok(info.includes('192.168.1.10 (wlan0)'));
        assert.ok(info.includes('8.8.8.8 (via https://api.ipify.org)'));

        // Mem and Disk
        assert.ok(info.includes('Total 3906 MB'));
        assert.ok(info.includes('Available 1953 MB'));
    });
});
