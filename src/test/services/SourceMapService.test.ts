import * as assert from 'assert';

import * as vscode from 'vscode';

import { Constants } from '../../Constants';
import { SourceMapService } from '../../services/SourceMapService';

suite('SourceMapService Test Suite', () => {
    let service: SourceMapService;

    const makeUri = (path: string): vscode.Uri => vscode.Uri.file(path);

    setup(() => {
        // @ts-expect-error: Resetting private singleton instance for testing
        SourceMapService.instance = undefined;
        service = SourceMapService.getInstance();
    });

    // --- register / hasMapping ---

    test('register adds mapping and hasMapping returns true', () => {
        const filtered = makeUri('/filtered/a.log');
        const source = makeUri('/source/a.log');

        service.register(filtered, source, [0, 5, 10]);
        assert.strictEqual(service.hasMapping(filtered), true);
    });

    test('hasMapping returns false for unregistered URI', () => {
        assert.strictEqual(service.hasMapping(makeUri('/not/registered.log')), false);
    });

    // --- getOriginalLocation ---

    test('getOriginalLocation returns correct location', () => {
        const filtered = makeUri('/filtered/b.log');
        const source = makeUri('/source/b.log');
        const lineMapping = [3, 7, 15];

        service.register(filtered, source, lineMapping);

        const loc = service.getOriginalLocation(filtered, 1);
        assert.ok(loc);
        assert.strictEqual(loc.uri.fsPath, source.fsPath);
        assert.strictEqual(loc.range.start.line, 7);
        assert.strictEqual(loc.range.start.character, 0);
    });

    test('getOriginalLocation returns undefined for unmapped URI', () => {
        const loc = service.getOriginalLocation(makeUri('/unknown.log'), 0);
        assert.strictEqual(loc, undefined);
    });

    test('getOriginalLocation returns undefined for out-of-range line', () => {
        const filtered = makeUri('/filtered/c.log');
        const source = makeUri('/source/c.log');

        service.register(filtered, source, [0, 1]);

        const loc = service.getOriginalLocation(filtered, 99);
        assert.strictEqual(loc, undefined);
    });

    // --- unregister ---

    test('unregister removes mapping', () => {
        const filtered = makeUri('/filtered/d.log');
        service.register(filtered, makeUri('/source/d.log'), [0]);

        service.unregister(filtered);
        assert.strictEqual(service.hasMapping(filtered), false);
    });

    test('unregister on non-existent URI does not throw', () => {
        assert.doesNotThrow(() => {
            service.unregister(makeUri('/nonexistent.log'));
        });
    });

    // --- cache eviction ---

    test('register evicts oldest mapping when maxMappings exceeded', () => {
        // @ts-expect-error: Accessing private static for testing
        const max: number = SourceMapService.maxMappings;

        // Fill cache to max
        for (let i = 0; i < max; i++) {
            service.register(makeUri(`/filtered/${i}.log`), makeUri(`/source/${i}.log`), [i]);
        }

        // The first one should still exist
        assert.strictEqual(service.hasMapping(makeUri('/filtered/0.log')), true);

        // Adding one more should evict the oldest (index 0)
        service.register(makeUri('/filtered/new.log'), makeUri('/source/new.log'), [999]);

        assert.strictEqual(service.hasMapping(makeUri('/filtered/0.log')), false);
        assert.strictEqual(service.hasMapping(makeUri('/filtered/new.log')), true);
        // Second oldest should still exist
        assert.strictEqual(service.hasMapping(makeUri('/filtered/1.log')), true);
    });

    // --- setPendingNavigation / checkAndConsumePendingNavigation ---

    test('checkAndConsumePendingNavigation returns false when no pending', () => {
        assert.strictEqual(
            service.checkAndConsumePendingNavigation(makeUri('/a.log'), 0),
            false
        );
    });

    test('setPendingNavigation then checkAndConsume returns true and consumes', () => {
        const uri = makeUri('/test.log');
        service.setPendingNavigation(uri, 5);

        assert.strictEqual(service.checkAndConsumePendingNavigation(uri, 5), true);
        // Second call should return false (consumed)
        assert.strictEqual(service.checkAndConsumePendingNavigation(uri, 5), false);
    });

    test('checkAndConsumePendingNavigation returns false for different URI', () => {
        service.setPendingNavigation(makeUri('/a.log'), 5);
        assert.strictEqual(
            service.checkAndConsumePendingNavigation(makeUri('/b.log'), 5),
            false
        );
    });

    test('checkAndConsumePendingNavigation returns false for different line', () => {
        const uri = makeUri('/test.log');
        service.setPendingNavigation(uri, 5);
        assert.strictEqual(service.checkAndConsumePendingNavigation(uri, 10), false);
    });

    test('checkAndConsumePendingNavigation returns false when expired', () => {
        const uri = makeUri('/test.log');
        service.setPendingNavigation(uri, 5);

        // Manually expire the pending navigation
        // @ts-expect-error: Accessing private field for testing
        service.pendingNavigation.timestamp = Date.now() - Constants.Defaults.NavigationWindowMs - 1;

        assert.strictEqual(service.checkAndConsumePendingNavigation(uri, 5), false);
    });

    test('setPendingNavigation reuses object when same uri and line', () => {
        const uri = makeUri('/test.log');
        service.setPendingNavigation(uri, 5);

        // @ts-expect-error: Accessing private field for testing
        const first = service.pendingNavigation;

        service.setPendingNavigation(uri, 5);

        // @ts-expect-error: Accessing private field for testing
        const second = service.pendingNavigation;

        // Same object reference (optimization path)
        assert.strictEqual(first, second);
    });

    test('setPendingNavigation creates new object when uri or line differs', () => {
        const uri = makeUri('/test.log');
        service.setPendingNavigation(uri, 5);

        // @ts-expect-error: Accessing private field for testing
        const first = service.pendingNavigation;

        service.setPendingNavigation(uri, 10);

        // @ts-expect-error: Accessing private field for testing
        const second = service.pendingNavigation;

        assert.notStrictEqual(first, second);
    });
});
