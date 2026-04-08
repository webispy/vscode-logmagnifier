/** Describes how to detect and parse a specific timestamp format. */
export interface TimestampFormat {
    name: string;
    regex: RegExp;
    /** Which capture group holds the timestamp string (0 = full match). */
    captureGroup: number;
    parse: (match: string) => Date;
}

/** A time-range node in the hierarchical tree (hour → sub → minute). */
export interface TimeRangeNode {
    startTime: Date;
    endTime: Date;
    startLine: number;
    endLine: number;
    lineCount: number;
    children?: TimeRangeNode[];
    level: 'hour' | 'sub' | 'minute';
}

/** Sparse timestamp index built from a document. */
export interface TimestampIndex {
    documentUri: string;
    format: TimestampFormat;
    firstTime: Date;
    lastTime: Date;
    totalLines: number;
    /** Maps line number → parsed Date (only lines that contain a timestamp). */
    lineTimestamps: Map<number, Date>;
    /** Pre-sorted entries from lineTimestamps, sorted by line number ascending. */
    sortedEntries: [number, Date][];
    hourBuckets: TimeRangeNode[];
}

/** A detected gap (silence) between two consecutive timestamped lines. */
export interface GapInfo {
    beforeLine: number;
    afterLine: number;
    beforeTime: Date;
    afterTime: Date;
    durationMs: number;
}
