/**
 * Fixed-capacity ring buffer that overwrites the oldest items when full.
 *
 * Used for maintaining a sliding window of recent items (e.g. context lines
 * preceding a matched log line).
 */
export class CircularBuffer<T> {
    private buffer: T[];
    private head: number = 0;
    private size: number = 0;

    /** @param capacity - Maximum number of items the buffer can hold. Zero disables storage. */
    constructor(private readonly capacity: number) {
        this.buffer = new Array(capacity);
    }

    /** Appends an item, overwriting the oldest entry if the buffer is full. */
    push(item: T): void {
        if (this.capacity === 0) {
            return;
        }
        if (this.size < this.capacity) {
            this.buffer[this.size++] = item;
        } else {
            this.buffer[this.head] = item;
            this.head = (this.head + 1) % this.capacity;
        }
    }

    /** Returns all items in insertion order (oldest first). */
    getAll(): T[] {
        if (this.size === 0) {
            return [];
        }
        if (this.size < this.capacity) {
            return this.buffer.slice(0, this.size);
        }
        // Reconstruct in order: from head to end, then 0 to head
        return [
            ...this.buffer.slice(this.head),
            ...this.buffer.slice(0, this.head)
        ];
    }

    /** Resets the buffer, discarding all stored items. */
    clear(): void {
        this.head = 0;
        this.size = 0;
    }

    /** The number of items currently stored (0 ≤ length ≤ capacity). */
    get length(): number {
        return this.size;
    }
}
