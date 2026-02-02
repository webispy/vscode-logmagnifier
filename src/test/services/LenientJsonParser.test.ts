import * as assert from 'assert';
import { LenientJsonParser, ParsedNode } from '../../services/LenientJsonParser';

suite('LenientJsonParser Test Suite', () => {
    let parser: LenientJsonParser;

    setup(() => {
        parser = new LenientJsonParser();
    });

    test('parses valid JSON', () => {
        const json = '{"key": "value", "num": 123, "bool": true, "arr": [1, 2]}';
        const result = parser.parse(json);

        assert.strictEqual(result.type, 'object');
        // We know structure for valid JSON
        assert.strictEqual(result.children?.length, 4);
    });

    test('parses valid primitives', () => {
        assert.strictEqual(parser.parse('"str"').type, 'string');
        assert.strictEqual(parser.parse('123').type, 'number');
        assert.strictEqual(parser.parse('true').type, 'boolean');
        assert.strictEqual(parser.parse('null').type, 'null');
    });

    test('recovers from missing quotes on keys', () => {
        const json = '{key: "value"}';
        const result = parser.parse(json);
        assert.strictEqual(result.type, 'object');

        const keyProp = result.children?.find(p => p.key === 'key');
        assert.ok(keyProp, 'Should find property with unquoted key');
        assert.strictEqual(keyProp!.isKeyError, true, 'Should mark unquoted key as error/lenient');
        assert.strictEqual(keyProp!.value.value, 'value');
    });

    test('recovers from missing commas', () => {
        const json = '{"a": 1 "b": 2}';
        const result = parser.parse(json);

        assert.strictEqual(result.type, 'object');
        assert.strictEqual(result.children?.length, 2);
        assert.strictEqual(result.children![0].key, 'a');
        assert.strictEqual(result.children![1].key, 'b');
    });

    test('recovers from missing closing braces', () => {
        const json = '{"a": 1';  // Missing }
        const result = parser.parse(json);

        assert.strictEqual(result.type, 'object');
        assert.strictEqual(result.isError, true, 'Should mark incomplete object as error');
        assert.strictEqual(result.children?.length, 1);
    });

    test('recovers from missing quotes on values (simple strings)', () => {
        const json = '{"key": value}';
        const result = parser.parse(json);

        const child = result.children![0];
        assert.strictEqual(child.value.type, 'string');
        assert.strictEqual(child.value.value, 'value');
        assert.strictEqual(child.value.isError, true, 'Should mark unquoted string value as error');
    });

    test('toParsedNode converts raw objects', () => {
        const raw = { foo: 'bar', list: [1, 2] };
        const node = LenientJsonParser.toParsedNode(raw);

        assert.strictEqual(node.type, 'object');
        assert.strictEqual(node.children?.length, 2);

        const foo = node.children!.find(c => c.key === 'foo');
        assert.strictEqual(foo!.value.value, 'bar');

        const list = node.children!.find(c => c.key === 'list');
        assert.strictEqual(list!.value.type, 'array');
        assert.strictEqual(list!.value.items?.length, 2);
    });
});
