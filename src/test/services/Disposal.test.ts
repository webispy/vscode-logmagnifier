import * as assert from 'assert';
import { AdbLogcatService } from '../../services/adb/AdbLogcatService';
import { AdbService } from '../../services/AdbService';
import { Logger } from '../../services/Logger';
import { AdbClient } from '../../services/adb/AdbClient';
import { AdbTargetAppService } from '../../services/adb/AdbTargetAppService';

suite('Disposal Test Suite', () => {
    let logger: Logger;

    setup(() => {
        logger = {
            info: () => { },
            warn: () => { },
            error: () => { },
            dispose: () => { }
        } as unknown as Logger;
    });

    test('AdbLogcatService dispose does not throw', () => {
        const client = {} as AdbClient;
        const targetAppService = {} as AdbTargetAppService;
        const service = new AdbLogcatService(logger, client, targetAppService);
        assert.doesNotThrow(() => {
            service.dispose();
        });
    });

    test('AdbService dispose does not throw', () => {
        const service = new AdbService(logger);
        assert.doesNotThrow(() => {
            service.dispose();
        });
    });
});
