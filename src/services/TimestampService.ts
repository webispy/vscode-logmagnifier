import { TimestampFormat, TimestampIndex, TimeRangeNode, GapInfo } from '../models/Timestamp';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Built-in timestamp formats, ordered from most specific to least. */
function getBuiltinFormats(): TimestampFormat[] {
    return [
        {
            name: 'iso8601',
            regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
            captureGroup: 1,
            parse(match: string): Date {
                return new Date(match);
            },
        },
        {
            name: 'apache',
            regex: /\[(\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2}\s[+-]\d{4})\]/,
            captureGroup: 1,
            parse(match: string): Date {
                // 30/Mar/2026:14:30:05 +0000
                const [datePart, tz] = match.split(' ');
                const [day, mon, rest] = datePart.split('/');
                const [year, hh, mm, ss] = rest.split(':');
                const monthIndex = MONTH_NAMES.indexOf(mon);
                const iso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day}T${hh}:${mm}:${ss}${tz.slice(0, 3)}:${tz.slice(3)}`;
                return new Date(iso);
            },
        },
        {
            name: 'datetime',
            regex: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
            captureGroup: 1,
            parse(match: string): Date {
                // Replace space with T for Date constructor
                return new Date(match.replace(' ', 'T'));
            },
        },
        {
            name: 'logcat',
            regex: /(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/,
            captureGroup: 1,
            parse(match: string): Date {
                // 03-30 14:30:05.123 — no year, use current year
                const [datePart, timePart] = match.split(' ');
                const [month, day] = datePart.split('-').map(Number);
                const [hms, ms] = timePart.split('.');
                const [h, m, s] = hms.split(':').map(Number);
                const date = new Date();
                date.setMonth(month - 1, day);
                date.setHours(h, m, s, Number(ms));
                return date;
            },
        },
        {
            name: 'syslog',
            regex: /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
            captureGroup: 1,
            parse(match: string): Date {
                // Mar 30 14:30:05
                const parts = match.split(/\s+/);
                const monthIndex = MONTH_NAMES.indexOf(parts[0]);
                const day = Number(parts[1]);
                const [h, m, s] = parts[2].split(':').map(Number);
                const date = new Date();
                date.setMonth(monthIndex, day);
                date.setHours(h, m, s, 0);
                return date;
            },
        },
        {
            name: 'time-only',
            regex: /(\d{2}:\d{2}:\d{2}[.,]\d{3})/,
            captureGroup: 1,
            parse(match: string): Date {
                const normalized = match.replace(',', '.');
                const [hms, ms] = normalized.split('.');
                const [h, m, s] = hms.split(':').map(Number);
                const date = new Date();
                date.setHours(h, m, s, Number(ms));
                return date;
            },
        },
        {
            name: 'epoch-ms',
            regex: /\b(\d{13})\b/,
            captureGroup: 1,
            parse(match: string): Date {
                return new Date(Number(match));
            },
        },
        {
            name: 'epoch-sec',
            regex: /\b(\d{10})\b/,
            captureGroup: 1,
            parse(match: string): Date {
                return new Date(Number(match) * 1000);
            },
        },
    ];
}

/** Maximum lines to sample for auto-detection. */
const DETECT_SAMPLE_SIZE = 100;
/** Minimum match ratio to accept a format (30%). */
const MIN_MATCH_RATIO = 0.3;

const DEFAULT_CACHE_MAX = 10;

export class TimestampService {
    private readonly builtinFormats = getBuiltinFormats();
    private readonly indexCache = new Map<string, TimestampIndex>();
    private readonly cacheMax: number;

    constructor(cacheMax = DEFAULT_CACHE_MAX) {
        this.cacheMax = cacheMax;
    }

    /** Return a cached index for the given URI, or undefined if not cached. */
    getIndex(documentUri: string): TimestampIndex | undefined {
        return this.indexCache.get(documentUri);
    }

    /** Remove a cached index for the given URI. */
    invalidateIndex(documentUri: string): void {
        this.indexCache.delete(documentUri);
    }

    /**
     * Detect the most likely timestamp format from a sample of lines.
     * Returns undefined if no format matches above threshold.
     */
    detectFormat(lines: string[]): TimestampFormat | undefined {
        if (lines.length === 0) {
            return undefined;
        }

        const sample = lines.slice(0, DETECT_SAMPLE_SIZE);
        let bestFormat: TimestampFormat | undefined;
        let bestCount = 0;

        for (const fmt of this.builtinFormats) {
            let matchCount = 0;
            for (const line of sample) {
                if (fmt.regex.test(line)) {
                    matchCount++;
                }
            }
            if (matchCount > bestCount) {
                bestCount = matchCount;
                bestFormat = fmt;
            }
        }

        if (!bestFormat || bestCount / sample.length < MIN_MATCH_RATIO) {
            return undefined;
        }

        return bestFormat;
    }

    /**
     * Generate status bar display text for an index.
     * Format: "$(watch) <format> | HH:MM~HH:MM"
     * Returns empty string if the index has no timestamps.
     */
    formatStatusBarText(index: TimestampIndex): string {
        if (index.lineTimestamps.size === 0) {
            return '';
        }
        const pad = (n: number) => String(n).padStart(2, '0');
        const startHH = pad(index.firstTime.getHours());
        const startMM = pad(index.firstTime.getMinutes());
        const endHH = pad(index.lastTime.getHours());
        const endMM = pad(index.lastTime.getMinutes());
        return `$(watch) ${index.format.name} | ${startHH}:${startMM}~${endHH}:${endMM}`;
    }

    /**
     * Build a timestamp index from lines using a detected format.
     * Produces a sparse lineTimestamps map and hierarchical hourBuckets.
     */
    buildIndex(lines: string[], format: TimestampFormat, documentUri: string): TimestampIndex {
        const lineTimestamps = new Map<number, Date>();

        for (let i = 0; i < lines.length; i++) {
            const match = format.regex.exec(lines[i]);
            if (match) {
                lineTimestamps.set(i, format.parse(match[format.captureGroup]));
            }
        }

        const sortedEntries = Array.from(lineTimestamps.entries()).sort((a, b) => a[0] - b[0]);
        const firstTime = sortedEntries.length > 0 ? sortedEntries[0][1] : new Date();
        const lastTime = sortedEntries.length > 0 ? sortedEntries[sortedEntries.length - 1][1] : new Date();

        const hourBuckets = this.buildHourBuckets(sortedEntries);

        const index: TimestampIndex = {
            documentUri,
            format,
            firstTime,
            lastTime,
            totalLines: lines.length,
            lineTimestamps,
            sortedEntries,
            hourBuckets,
        };

        // Evict oldest entries if cache is full
        if (this.indexCache.size >= this.cacheMax && !this.indexCache.has(documentUri)) {
            const oldestKey = this.indexCache.keys().next().value;
            if (oldestKey !== undefined) {
                this.indexCache.delete(oldestKey);
            }
        }
        this.indexCache.set(documentUri, index);

        return index;
    }

    /**
     * Find gaps (silences) in the index above a duration threshold in milliseconds.
     */
    findGaps(index: TimestampIndex, thresholdMs: number): GapInfo[] {
        const entries = index.sortedEntries;
        const gaps: GapInfo[] = [];

        for (let i = 1; i < entries.length; i++) {
            const [prevLine, prevTime] = entries[i - 1];
            const [currLine, currTime] = entries[i];
            const durationMs = currTime.getTime() - prevTime.getTime();
            if (durationMs >= thresholdMs) {
                gaps.push({
                    beforeLine: prevLine,
                    afterLine: currLine,
                    beforeTime: prevTime,
                    afterTime: currTime,
                    durationMs,
                });
            }
        }

        return gaps;
    }

    /**
     * Find gaps within a specific line range of an index.
     * Same logic as findGaps but restricted to [startLine, endLine].
     */
    findGapsInRange(index: TimestampIndex, startLine: number, endLine: number, thresholdMs: number): GapInfo[] {
        const entries = index.sortedEntries
            .filter(([line]) => line >= startLine && line <= endLine);
        const gaps: GapInfo[] = [];

        for (let i = 1; i < entries.length; i++) {
            const [prevLine, prevTime] = entries[i - 1];
            const [currLine, currTime] = entries[i];
            const durationMs = currTime.getTime() - prevTime.getTime();
            if (durationMs >= thresholdMs) {
                gaps.push({
                    beforeLine: prevLine,
                    afterLine: currLine,
                    beforeTime: prevTime,
                    afterTime: currTime,
                    durationMs,
                });
            }
        }

        return gaps;
    }

    /**
     * Binary search for the line closest to (but not after) the target time.
     * Returns -1 if the index is empty.
     */
    findLineByTime(index: TimestampIndex, targetTime: Date): number {
        const entries = index.sortedEntries;
        if (entries.length === 0) {
            return -1;
        }

        const targetMs = targetTime.getTime();

        // Before first entry
        if (targetMs <= entries[0][1].getTime()) {
            return entries[0][0];
        }
        // After last entry
        if (targetMs >= entries[entries.length - 1][1].getTime()) {
            return entries[entries.length - 1][0];
        }

        let lo = 0;
        let hi = entries.length - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            if (entries[mid][1].getTime() <= targetMs) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        return entries[lo][0];
    }

    /**
     * Parse a user-supplied time input string into a Date.
     *
     * Supported formats:
     * - Absolute: "14:32", "14:32:15", "14:32:15.123"
     * - Relative: "+5m", "-30s", "+1h"
     *
     * Absolute times use the date from referenceDate (typically index.firstTime).
     * Relative times offset from cursorTime (the timestamp at the current cursor line).
     *
     * @returns parsed Date, or undefined if the input is invalid
     */
    parseTimeInput(input: string, referenceDate: Date, cursorTime?: Date): Date | undefined {
        const trimmed = input.trim();
        if (!trimmed) {
            return undefined;
        }

        // Relative time: +5m, -30s, +1h, +100ms
        const relMatch = /^([+-])(\d+)(h|m|s|ms)$/.exec(trimmed);
        if (relMatch) {
            if (!cursorTime) {
                return undefined;
            }
            const sign = relMatch[1] === '+' ? 1 : -1;
            const value = parseInt(relMatch[2], 10);
            const unit = relMatch[3];
            let offsetMs = 0;
            switch (unit) {
                case 'h': offsetMs = value * 3600_000; break;
                case 'm': offsetMs = value * 60_000; break;
                case 's': offsetMs = value * 1000; break;
                case 'ms': offsetMs = value; break;
            }
            return new Date(cursorTime.getTime() + sign * offsetMs);
        }

        // Absolute time: HH:MM, HH:MM:SS, HH:MM:SS.mmm
        const absMatch = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(trimmed);
        if (absMatch) {
            const h = parseInt(absMatch[1], 10);
            const m = parseInt(absMatch[2], 10);
            const s = absMatch[3] !== undefined ? parseInt(absMatch[3], 10) : 0;
            const ms = absMatch[4] !== undefined ? parseInt(absMatch[4].padEnd(3, '0'), 10) : 0;
            if (h > 23 || m > 59 || s > 59 || ms > 999) {
                return undefined;
            }
            const result = new Date(referenceDate);
            result.setHours(h, m, s, ms);
            return result;
        }

        return undefined;
    }

    /**
     * Parse a single line using the given format.
     * Returns the parsed Date, or undefined if the line has no timestamp.
     */
    parseLine(line: string, format: TimestampFormat): Date | undefined {
        const match = format.regex.exec(line);
        if (!match) {
            return undefined;
        }
        return format.parse(match[format.captureGroup]);
    }

    /**
     * Filter lines by time range, returning only lines within [startTime, endTime].
     * Lines without a timestamp are included if they fall between two timestamped
     * lines that are within the range (context lines such as stack traces).
     *
     * @returns filtered lines and a 0-based line mapping (output index → source line number)
     */
    filterLinesByTimeRange(
        lines: string[],
        format: TimestampFormat,
        startTime?: Date,
        endTime?: Date,
    ): { filteredLines: string[]; lineMapping: number[] } {
        const startMs = startTime?.getTime() ?? -Infinity;
        const endMs = endTime?.getTime() ?? Infinity;

        const filteredLines: string[] = [];
        const lineMapping: number[] = [];

        let lastTimestampInRange = false;

        for (let i = 0; i < lines.length; i++) {
            const ts = this.parseLine(lines[i], format);
            if (ts) {
                const tsMs = ts.getTime();
                lastTimestampInRange = tsMs >= startMs && tsMs <= endMs;
            }
            // Include line if last seen timestamp is within range
            if (lastTimestampInRange) {
                filteredLines.push(lines[i]);
                lineMapping.push(i);
            }
        }

        return { filteredLines, lineMapping };
    }

    // ── Private helpers ──

    private buildHourBuckets(sortedEntries: [number, Date][]): TimeRangeNode[] {
        if (sortedEntries.length === 0) {
            return [];
        }

        const hourGroups = new Map<number, [number, Date][]>();
        for (const entry of sortedEntries) {
            const hour = entry[1].getHours();
            let group = hourGroups.get(hour);
            if (!group) {
                group = [];
                hourGroups.set(hour, group);
            }
            group.push(entry);
        }

        const buckets: TimeRangeNode[] = [];
        const sortedHours = Array.from(hourGroups.keys()).sort((a, b) => a - b);

        for (const hour of sortedHours) {
            const entries = hourGroups.get(hour) ?? [];
            const startTime = entries[0][1];
            const endTime = entries[entries.length - 1][1];
            const startLine = entries[0][0];
            const endLine = entries[entries.length - 1][0];

            const children = this.buildSubBuckets(entries);

            buckets.push({
                startTime,
                endTime,
                startLine,
                endLine,
                lineCount: entries.length,
                level: 'hour',
                children,
            });
        }

        return buckets;
    }

    private buildSubBuckets(entries: [number, Date][]): TimeRangeNode[] {
        // Group into 5-minute intervals
        const subGroups = new Map<number, [number, Date][]>();
        for (const entry of entries) {
            const minutes = entry[1].getMinutes();
            const bucket = Math.floor(minutes / 5) * 5;
            let group = subGroups.get(bucket);
            if (!group) {
                group = [];
                subGroups.set(bucket, group);
            }
            group.push(entry);
        }

        const nodes: TimeRangeNode[] = [];
        const sortedBuckets = Array.from(subGroups.keys()).sort((a, b) => a - b);

        for (const bucket of sortedBuckets) {
            const subEntries = subGroups.get(bucket) ?? [];
            const children = this.buildMinuteBuckets(subEntries);

            nodes.push({
                startTime: subEntries[0][1],
                endTime: subEntries[subEntries.length - 1][1],
                startLine: subEntries[0][0],
                endLine: subEntries[subEntries.length - 1][0],
                lineCount: subEntries.length,
                level: 'sub',
                children,
            });
        }

        return nodes;
    }

    private buildMinuteBuckets(entries: [number, Date][]): TimeRangeNode[] {
        const minuteGroups = new Map<number, [number, Date][]>();
        for (const entry of entries) {
            const minute = entry[1].getMinutes();
            let group = minuteGroups.get(minute);
            if (!group) {
                group = [];
                minuteGroups.set(minute, group);
            }
            group.push(entry);
        }

        const nodes: TimeRangeNode[] = [];
        const sortedMinutes = Array.from(minuteGroups.keys()).sort((a, b) => a - b);

        for (const minute of sortedMinutes) {
            const minEntries = minuteGroups.get(minute) ?? [];
            nodes.push({
                startTime: minEntries[0][1],
                endTime: minEntries[minEntries.length - 1][1],
                startLine: minEntries[0][0],
                endLine: minEntries[minEntries.length - 1][0],
                lineCount: minEntries.length,
                level: 'minute',
            });
        }

        return nodes;
    }
}
