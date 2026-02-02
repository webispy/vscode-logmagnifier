import * as assert from 'assert';
import { LogProcessor, CompiledGroup } from '../../services/LogProcessor';
import { RegexUtils } from '../../utils/RegexUtils';

suite('LogProcessor Test Suite', () => {
    let processor: LogProcessor;

    setup(() => {
        processor = new LogProcessor();
    });

    test('checkMatchCompiled: empty groups should match nothing', () => {
        const result = processor.checkMatchCompiled('some log line', []);
        assert.strictEqual(result.isMatched, false);
    });

    test('checkMatchCompiled: basic include filter', () => {
        const group: CompiledGroup = {
            includes: [{ regex: RegexUtils.create('Error', false, false), contextLine: 0 }],
            excludes: []
        };

        assert.strictEqual(processor.checkMatchCompiled('An Error occurred', [group]).isMatched, true);
        assert.strictEqual(processor.checkMatchCompiled('Just a warning', [group]).isMatched, false);
    });

    test('checkMatchCompiled: basic exclude filter', () => {
        // Create regex wrapper manually or using utils, ensuring it's a RegExp object.
        const regex = RegexUtils.create('Debug', false, false);
        const group: CompiledGroup = {
            includes: [],
            excludes: [regex]
        };

        // If no includes, we assume include all EXCEPT excludes
        assert.strictEqual(processor.checkMatchCompiled('Important Info', [group]).isMatched, true);
        assert.strictEqual(processor.checkMatchCompiled('Debug message', [group]).isMatched, false);
    });

    test('checkMatchCompiled: include AND exclude interaction', () => {
        const includeRegex = RegexUtils.create('Error', false, false);
        const excludeRegex = RegexUtils.create('Ignored', false, false);

        const group: CompiledGroup = {
            includes: [{ regex: includeRegex, contextLine: 0 }],
            excludes: [excludeRegex]
        };

        // Needs to match 'Error' AND NOT 'Ignored'
        assert.strictEqual(processor.checkMatchCompiled('Critical Error', [group]).isMatched, true);
        assert.strictEqual(processor.checkMatchCompiled('Ignored Error', [group]).isMatched, false); // Excluded
        assert.strictEqual(processor.checkMatchCompiled('Just Info', [group]).isMatched, false); // Not included
    });

    test('checkMatchCompiled: context lines calculation', () => {
        const group: CompiledGroup = {
            includes: [
                { regex: RegexUtils.create('Critical', false, false), contextLine: 5 },
                { regex: RegexUtils.create('Error', false, false), contextLine: 2 }
            ],
            excludes: []
        };

        const result1 = processor.checkMatchCompiled('Critical failure', [group]);
        assert.strictEqual(result1.isMatched, true);
        assert.strictEqual(result1.contextLines, 5);

        const result2 = processor.checkMatchCompiled('Minor Error', [group]);
        assert.strictEqual(result2.isMatched, true);
        assert.strictEqual(result2.contextLines, 2);
    });
});
