import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import { LogProcessor } from '../../services/LogProcessor';
import { FilterGroup, FilterType } from '../../models/Filter';
import { FileHierarchyService } from '../../services/FileHierarchyService';
import { Logger } from '../../services/Logger';
import { MockExtensionContext } from '../utils/Mocks';
import * as vscode from 'vscode';

/**
 * LogProcessor streaming edge-case tests.
 *
 * Covers: file truncated mid-line, empty files, CRLF handling,
 * single-line files, and very long lines.
 */
suite('LogProcessor Streaming Edge Cases', () => {
    let processor: LogProcessor;
    let tmpDir: string;

    function createGroup(id: string, name: string): FilterGroup {
        return { id, name, filters: [], isEnabled: true, isRegex: false, isExpanded: true };
    }

    function createFilter(id: string, pattern: string, type: FilterType) {
        return { id, pattern, type, isEnabled: true, isRegex: false, contextLines: 0, caseSensitive: false };
    }

    setup(async () => {
        // @ts-expect-error: Resetting private singleton instance for testing
        FileHierarchyService.instance = undefined;
        FileHierarchyService.createInstance(new MockExtensionContext() as unknown as vscode.ExtensionContext, Logger.getInstance());
        processor = new LogProcessor();
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'logproc-test-'));
    });

    teardown(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    test('empty file produces zero matches', async () => {
        const emptyFile = path.join(tmpDir, 'empty.log');
        await fsp.writeFile(emptyFile, '');

        const group = createGroup('g1', 'G');
        group.filters.push(createFilter('f1', 'ERROR', 'include'));

        const result = await processor.processFile(emptyFile, [group]);
        assert.strictEqual(result.processed, 0);
        assert.strictEqual(result.matched, 0);

        if (fs.existsSync(result.outputPath)) { fs.unlinkSync(result.outputPath); }
    });

    test('file without trailing newline processes all lines', async () => {
        const noNewline = path.join(tmpDir, 'no-newline.log');
        await fsp.writeFile(noNewline, 'ERROR line1\nINFO line2\nERROR line3');

        const group = createGroup('g1', 'G');
        group.filters.push(createFilter('f1', 'ERROR', 'include'));

        const result = await processor.processFile(noNewline, [group]);
        assert.strictEqual(result.matched, 2, 'Should match both ERROR lines even without trailing newline');

        if (fs.existsSync(result.outputPath)) { fs.unlinkSync(result.outputPath); }
    });

    test('CRLF line endings are handled correctly', async () => {
        const crlfFile = path.join(tmpDir, 'crlf.log');
        await fsp.writeFile(crlfFile, 'ERROR first\r\nINFO second\r\nERROR third\r\n');

        const group = createGroup('g1', 'G');
        group.filters.push(createFilter('f1', 'ERROR', 'include'));

        const result = await processor.processFile(crlfFile, [group]);
        assert.strictEqual(result.matched, 2, 'Should match 2 ERROR lines with CRLF endings');

        if (fs.existsSync(result.outputPath)) { fs.unlinkSync(result.outputPath); }
    });

    test('single-line file is processed', async () => {
        const singleLine = path.join(tmpDir, 'single.log');
        await fsp.writeFile(singleLine, 'ERROR the only line\n');

        const group = createGroup('g1', 'G');
        group.filters.push(createFilter('f1', 'ERROR', 'include'));

        const result = await processor.processFile(singleLine, [group]);
        assert.strictEqual(result.processed, 1);
        assert.strictEqual(result.matched, 1);

        if (fs.existsSync(result.outputPath)) { fs.unlinkSync(result.outputPath); }
    });

    test('very long line does not crash', async () => {
        const longLineFile = path.join(tmpDir, 'longline.log');
        const longLine = 'ERROR ' + 'x'.repeat(100_000);
        await fsp.writeFile(longLineFile, longLine + '\nshort\n');

        const group = createGroup('g1', 'G');
        group.filters.push(createFilter('f1', 'ERROR', 'include'));

        const result = await processor.processFile(longLineFile, [group]);
        assert.strictEqual(result.matched, 1);

        if (fs.existsSync(result.outputPath)) { fs.unlinkSync(result.outputPath); }
    });

    test('context lines at file boundaries do not overflow', async () => {
        const boundaryFile = path.join(tmpDir, 'boundary.log');
        // ERROR is on line 1 (first line), context=3 should not go negative
        await fsp.writeFile(boundaryFile, 'ERROR first\nINFO second\nINFO third\n');

        const group = createGroup('g1', 'G');
        const filter = createFilter('f1', 'ERROR', 'include');
        filter.contextLines = 3;
        group.filters.push(filter);

        const result = await processor.processFile(boundaryFile, [group]);
        assert.strictEqual(result.matched, 1, 'Should match 1 primary line');

        const content = fs.readFileSync(result.outputPath, 'utf8').trim().split('\n');
        assert.strictEqual(content.length, 3, 'Should output all 3 lines (1 match + 2 context after)');

        if (fs.existsSync(result.outputPath)) { fs.unlinkSync(result.outputPath); }
    });
});
