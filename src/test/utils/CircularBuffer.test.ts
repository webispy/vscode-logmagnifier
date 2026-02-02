import * as assert from 'assert';
import { CircularBuffer } from '../../utils/CircularBuffer';

suite('CircularBuffer Test Suite', () => {
    test('push and getAll maintain correct order and capacity', () => {
        const buffer = new CircularBuffer<number>(3);

        // Push 1, buffer: [1]
        buffer.push(1);
        assert.deepStrictEqual(buffer.getAll(), [1]);
        assert.strictEqual(buffer.length, 1);

        // Push 2, buffer: [1, 2]
        buffer.push(2);
        assert.deepStrictEqual(buffer.getAll(), [1, 2]);
        assert.strictEqual(buffer.length, 2);

        // Push 3, buffer: [1, 2, 3] (Full)
        buffer.push(3);
        assert.deepStrictEqual(buffer.getAll(), [1, 2, 3]);
        assert.strictEqual(buffer.length, 3);

        // Push 4, buffer: [2, 3, 4] (Overflow, 1 evicted)
        buffer.push(4);
        assert.deepStrictEqual(buffer.getAll(), [2, 3, 4]);
        assert.strictEqual(buffer.length, 3);

        // Push 5, buffer: [3, 4, 5]
        buffer.push(5);
        assert.deepStrictEqual(buffer.getAll(), [3, 4, 5]);
        assert.strictEqual(buffer.length, 3);
    });

    test('clear resets the buffer', () => {
        const buffer = new CircularBuffer<string>(3);
        buffer.push('a');
        buffer.push('b');
        buffer.push('c');
        assert.strictEqual(buffer.length, 3);

        buffer.clear();
        assert.strictEqual(buffer.length, 0);
        assert.deepStrictEqual(buffer.getAll(), []);

        // Start fresh
        buffer.push('x');
        assert.deepStrictEqual(buffer.getAll(), ['x']);
    });

    test('handles zero capacity', () => {
        const buffer = new CircularBuffer<number>(0);
        buffer.push(1);
        assert.strictEqual(buffer.length, 0);
        assert.deepStrictEqual(buffer.getAll(), []);
    });

    test('handles single capacity', () => {
        const buffer = new CircularBuffer<number>(1);
        buffer.push(1);
        assert.deepStrictEqual(buffer.getAll(), [1]);
        buffer.push(2);
        assert.deepStrictEqual(buffer.getAll(), [2]);
    });
});
