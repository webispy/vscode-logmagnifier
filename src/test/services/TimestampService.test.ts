import * as assert from 'assert';
import { TimestampService } from '../../services/TimestampService';

suite('TimestampService Test Suite', () => {
    let service: TimestampService;

    setup(() => {
        service = new TimestampService();
    });

    // ── Step 2: Format Detection ──

    suite('detectFormat', () => {
        test('empty lines should return undefined', () => {
            const result = service.detectFormat([]);
            assert.strictEqual(result, undefined);
        });

        test('plain text without timestamps should return undefined', () => {
            const lines = [
                'just a regular line',
                'no timestamps here',
                'nothing to detect',
            ];
            assert.strictEqual(service.detectFormat(lines), undefined);
        });

        test('should detect Android logcat format', () => {
            const lines = [
                '03-30 14:30:05.123  1234  5678 D Tag: message one',
                '03-30 14:30:05.456  1234  5678 I Tag: message two',
                '03-30 14:30:06.789  1234  5678 W Tag: message three',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'logcat');
        });

        test('should detect ISO 8601 format', () => {
            const lines = [
                '2026-03-30T14:30:05.123Z INFO  started',
                '2026-03-30T14:30:06.456Z DEBUG processing',
                '2026-03-30T14:30:07.789Z WARN  done',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'iso8601');
        });

        test('should detect datetime space format', () => {
            const lines = [
                '2026-03-30 14:30:05.123 INFO started',
                '2026-03-30 14:30:06.456 DEBUG processing',
                '2026-03-30 14:30:07 WARN done',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'datetime');
        });

        test('should detect syslog BSD format', () => {
            const lines = [
                'Mar 30 14:30:05 myhost sshd[1234]: accepted publickey',
                'Mar 30 14:30:06 myhost sshd[1234]: session opened',
                'Mar 30 14:30:07 myhost kernel: something happened',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'syslog');
        });

        test('should detect time-only (ms) format', () => {
            const lines = [
                '14:30:05.123 some event',
                '14:30:05.456 another event',
                '14:30:06.789 third event',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'time-only');
        });

        test('should detect Apache/Nginx format', () => {
            const lines = [
                '192.168.1.1 - - [30/Mar/2026:14:30:05 +0900] "GET / HTTP/1.1" 200',
                '192.168.1.2 - - [30/Mar/2026:14:30:06 +0900] "POST /api HTTP/1.1" 201',
                '192.168.1.3 - - [30/Mar/2026:14:30:07 +0900] "GET /index HTTP/1.1" 200',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'apache');
        });

        test('should detect Unix epoch seconds format', () => {
            const lines = [
                '1743350005 INFO started',
                '1743350006 DEBUG processing',
                '1743350007 WARN done',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'epoch-sec');
        });

        test('should detect Unix epoch milliseconds format', () => {
            const lines = [
                '1743350005123 INFO started',
                '1743350006456 DEBUG processing',
                '1743350007789 WARN done',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'epoch-ms');
        });

        test('should pick format with highest match rate in mixed lines', () => {
            // 7 logcat lines, 2 lines with possible epoch-like numbers
            const lines = [
                '03-30 14:30:05.123  1234  5678 D Tag: msg',
                '03-30 14:30:05.456  1234  5678 I Tag: msg',
                '03-30 14:30:06.789  1234  5678 W Tag: msg',
                'plain text no timestamp',
                '03-30 14:30:07.000  1234  5678 E Tag: msg',
                '03-30 14:30:08.111  1234  5678 D Tag: msg',
                '03-30 14:30:09.222  1234  5678 I Tag: msg',
                '03-30 14:30:10.333  1234  5678 V Tag: msg',
            ];
            const fmt = service.detectFormat(lines);
            assert.ok(fmt, 'format should be detected');
            assert.strictEqual(fmt.name, 'logcat');
        });
    });

    // ── Step 3: Timestamp Parsing ──

    suite('parse', () => {
        test('logcat parse returns correct Date (uses current year)', () => {
            const lines = ['03-30 14:30:05.123  1234  5678 D Tag: msg'];
            const fmt = service.detectFormat(lines)!;
            const match = fmt.regex.exec(lines[0]);
            assert.ok(match);
            const date = fmt.parse(match[fmt.captureGroup]);
            assert.strictEqual(date.getMonth(), 2); // March = 2
            assert.strictEqual(date.getDate(), 30);
            assert.strictEqual(date.getHours(), 14);
            assert.strictEqual(date.getMinutes(), 30);
            assert.strictEqual(date.getSeconds(), 5);
            assert.strictEqual(date.getMilliseconds(), 123);
        });

        test('iso8601 parse returns correct Date', () => {
            const lines = ['2026-03-30T14:30:05.123Z INFO msg'];
            const fmt = service.detectFormat(lines)!;
            const match = fmt.regex.exec(lines[0]);
            assert.ok(match);
            const date = fmt.parse(match[fmt.captureGroup]);
            assert.strictEqual(date.getUTCFullYear(), 2026);
            assert.strictEqual(date.getUTCMonth(), 2);
            assert.strictEqual(date.getUTCDate(), 30);
            assert.strictEqual(date.getUTCHours(), 14);
            assert.strictEqual(date.getUTCMinutes(), 30);
        });

        test('syslog parse handles month string (Jan–Dec)', () => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            for (let i = 0; i < months.length; i++) {
                const lines = [`${months[i]}  5 09:00:00 host svc: msg`];
                const fmt = service.detectFormat(lines)!;
                const match = fmt.regex.exec(lines[0]);
                assert.ok(match, `should match ${months[i]}`);
                const date = fmt.parse(match[fmt.captureGroup]);
                assert.strictEqual(date.getMonth(), i, `month index for ${months[i]}`);
            }
        });

        test('epoch-sec parse returns correct Date', () => {
            const lines = ['1743350005 INFO msg'];
            const fmt = service.detectFormat(lines)!;
            const match = fmt.regex.exec(lines[0]);
            assert.ok(match);
            const date = fmt.parse(match[fmt.captureGroup]);
            assert.strictEqual(date.getTime(), 1743350005 * 1000);
        });

        test('epoch-ms parse returns correct Date', () => {
            const lines = ['1743350005123 INFO msg'];
            const fmt = service.detectFormat(lines)!;
            const match = fmt.regex.exec(lines[0]);
            assert.ok(match);
            const date = fmt.parse(match[fmt.captureGroup]);
            assert.strictEqual(date.getTime(), 1743350005123);
        });

        test('datetime parse returns correct Date', () => {
            const lines = ['2026-03-30 14:30:05.123 INFO msg'];
            const fmt = service.detectFormat(lines)!;
            const match = fmt.regex.exec(lines[0]);
            assert.ok(match);
            const date = fmt.parse(match[fmt.captureGroup]);
            assert.strictEqual(date.getFullYear(), 2026);
            assert.strictEqual(date.getMonth(), 2);
            assert.strictEqual(date.getDate(), 30);
            assert.strictEqual(date.getHours(), 14);
            assert.strictEqual(date.getMinutes(), 30);
            assert.strictEqual(date.getSeconds(), 5);
        });

        test('apache parse returns correct Date', () => {
            const lines = ['1.2.3.4 - - [30/Mar/2026:14:30:05 +0000] "GET /"'];
            const fmt = service.detectFormat(lines)!;
            const match = fmt.regex.exec(lines[0]);
            assert.ok(match);
            const date = fmt.parse(match[fmt.captureGroup]);
            assert.strictEqual(date.getUTCFullYear(), 2026);
            assert.strictEqual(date.getUTCMonth(), 2);
            assert.strictEqual(date.getUTCDate(), 30);
        });

        test('time-only parse returns correct time components', () => {
            const lines = ['14:30:05.123 event'];
            const fmt = service.detectFormat(lines)!;
            const match = fmt.regex.exec(lines[0]);
            assert.ok(match);
            const date = fmt.parse(match[fmt.captureGroup]);
            assert.strictEqual(date.getHours(), 14);
            assert.strictEqual(date.getMinutes(), 30);
            assert.strictEqual(date.getSeconds(), 5);
            assert.strictEqual(date.getMilliseconds(), 123);
        });
    });

    // ── Step 4: Index Building ──

    suite('buildIndex', () => {
        test('simple log builds correct lineTimestamps map', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: line0',
                '03-30 10:00:01.000  1234  5678 D Tag: line1',
                '03-30 10:00:02.000  1234  5678 D Tag: line2',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'test-uri');
            assert.strictEqual(index.lineTimestamps.size, 3);
            assert.ok(index.lineTimestamps.has(0));
            assert.ok(index.lineTimestamps.has(1));
            assert.ok(index.lineTimestamps.has(2));
        });

        test('lines without timestamps are excluded from sparse map', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: timestamped',
                '    continuation line without timestamp',
                '    another continuation',
                '03-30 10:00:01.000  1234  5678 D Tag: timestamped again',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'test-uri');
            assert.strictEqual(index.lineTimestamps.size, 2);
            assert.ok(index.lineTimestamps.has(0));
            assert.ok(!index.lineTimestamps.has(1));
            assert.ok(!index.lineTimestamps.has(2));
            assert.ok(index.lineTimestamps.has(3));
        });

        test('firstTime and lastTime are correct', () => {
            const lines = [
                '03-30 09:00:00.000  1234  5678 D Tag: first',
                '03-30 12:30:00.000  1234  5678 D Tag: middle',
                '03-30 18:00:00.000  1234  5678 D Tag: last',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'test-uri');
            assert.strictEqual(index.firstTime.getHours(), 9);
            assert.strictEqual(index.lastTime.getHours(), 18);
        });

        test('totalLines equals input length', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                'no timestamp',
                '03-30 10:00:01.000  1234  5678 D Tag: b',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'test-uri');
            assert.strictEqual(index.totalLines, 3);
        });

        test('hourBuckets groups by hour correctly', () => {
            const lines = [
                '03-30 09:00:00.000  1234  5678 D Tag: a',
                '03-30 09:30:00.000  1234  5678 D Tag: b',
                '03-30 10:00:00.000  1234  5678 D Tag: c',
                '03-30 10:15:00.000  1234  5678 D Tag: d',
                '03-30 10:45:00.000  1234  5678 D Tag: e',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'test-uri');
            assert.strictEqual(index.hourBuckets.length, 2);
            assert.strictEqual(index.hourBuckets[0].lineCount, 2); // 09:xx
            assert.strictEqual(index.hourBuckets[1].lineCount, 3); // 10:xx
        });

        test('handles 1000 lines without error', () => {
            const lines: string[] = [];
            for (let i = 0; i < 1000; i++) {
                const min = String(Math.floor(i / 60) % 60).padStart(2, '0');
                const sec = String(i % 60).padStart(2, '0');
                lines.push(`03-30 10:${min}:${sec}.000  1234  5678 D Tag: line${i}`);
            }
            const fmt = service.detectFormat(lines)!;
            const start = Date.now();
            const index = service.buildIndex(lines, fmt, 'test-uri');
            const elapsed = Date.now() - start;
            assert.strictEqual(index.lineTimestamps.size, 1000);
            assert.ok(elapsed < 1000, `should complete in <1s, took ${elapsed}ms`);
        });
    });

    // ── Step 5: Tree Building ──

    suite('buildTree', () => {
        function makeIndex(hours: number[]): { lines: string[]; fmt: ReturnType<TimestampService['detectFormat']> } {
            const lines: string[] = [];
            for (const h of hours) {
                const hh = String(h).padStart(2, '0');
                lines.push(`03-30 ${hh}:00:00.000  1234  5678 D Tag: msg`);
            }
            return { lines, fmt: new TimestampService().detectFormat(lines) };
        }

        test('single hour produces one hour node', () => {
            const { lines, fmt } = makeIndex([10, 10, 10]);
            assert.ok(fmt);
            const index = service.buildIndex(lines, fmt, 'uri');
            assert.strictEqual(index.hourBuckets.length, 1);
            assert.strictEqual(index.hourBuckets[0].level, 'hour');
        });

        test('multiple hours produce multiple hour nodes', () => {
            const { lines, fmt } = makeIndex([9, 10, 11]);
            assert.ok(fmt);
            const index = service.buildIndex(lines, fmt, 'uri');
            assert.strictEqual(index.hourBuckets.length, 3);
        });

        test('hour node has sub-level children', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:05:00.000  1234  5678 D Tag: b',
                '03-30 10:10:00.000  1234  5678 D Tag: c',
                '03-30 10:20:00.000  1234  5678 D Tag: d',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const hourNode = index.hourBuckets[0];
            assert.ok(hourNode.children, 'hour node should have children');
            assert.ok(hourNode.children.length > 0);
            assert.strictEqual(hourNode.children[0].level, 'sub');
        });

        test('lineCount sums correctly across hierarchy', () => {
            const lines = [
                '03-30 10:01:00.000  1234  5678 D Tag: a',
                '03-30 10:02:00.000  1234  5678 D Tag: b',
                '03-30 10:03:00.000  1234  5678 D Tag: c',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const hourNode = index.hourBuckets[0];
            assert.strictEqual(hourNode.lineCount, 3);
            if (hourNode.children) {
                const childSum = hourNode.children.reduce((s, c) => s + c.lineCount, 0);
                assert.strictEqual(childSum, 3);
            }
        });

        test('startLine and endLine are correct', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:30:00.000  1234  5678 D Tag: b',
                '03-30 11:00:00.000  1234  5678 D Tag: c',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            assert.strictEqual(index.hourBuckets[0].startLine, 0);
            assert.strictEqual(index.hourBuckets[0].endLine, 1);
            assert.strictEqual(index.hourBuckets[1].startLine, 2);
            assert.strictEqual(index.hourBuckets[1].endLine, 2);
        });
    });

    // ── Step 6: Gap Analysis ──

    suite('findGaps', () => {
        test('continuous timestamps below threshold return empty array', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:00.500  1234  5678 D Tag: b',
                '03-30 10:00:01.000  1234  5678 D Tag: c',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const gaps = service.findGaps(index, 2000);
            assert.strictEqual(gaps.length, 0);
        });

        test('detects gap above threshold', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:05.000  1234  5678 D Tag: b',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const gaps = service.findGaps(index, 1000);
            assert.strictEqual(gaps.length, 1);
            assert.strictEqual(gaps[0].beforeLine, 0);
            assert.strictEqual(gaps[0].afterLine, 1);
            assert.strictEqual(gaps[0].durationMs, 5000);
        });

        test('multiple gaps are returned in order', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:03.000  1234  5678 D Tag: b', // +3s gap
                '03-30 10:00:03.500  1234  5678 D Tag: c',
                '03-30 10:00:10.000  1234  5678 D Tag: d', // +6.5s gap
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const gaps = service.findGaps(index, 1000);
            assert.strictEqual(gaps.length, 2);
            assert.strictEqual(gaps[0].beforeLine, 0);
            assert.strictEqual(gaps[1].beforeLine, 2);
            assert.ok(gaps[0].durationMs < gaps[1].durationMs);
        });

        test('durationMs is accurate', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:02.500  1234  5678 D Tag: b',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const gaps = service.findGaps(index, 1000);
            assert.strictEqual(gaps.length, 1);
            assert.strictEqual(gaps[0].durationMs, 2500);
        });
    });

    // ── Step 7.5: Status Bar Text ──

    suite('formatStatusBarText', () => {
        test('returns format name and time range', () => {
            const lines = [
                '03-30 09:15:00.000  1234  5678 D Tag: first',
                '03-30 11:42:00.000  1234  5678 D Tag: last',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const text = service.formatStatusBarText(index);
            assert.ok(text.includes('logcat'), `should contain format name, got: ${text}`);
            assert.ok(text.includes('09:15'), `should contain start time, got: ${text}`);
            assert.ok(text.includes('11:42'), `should contain end time, got: ${text}`);
        });

        test('returns empty string for index with no timestamps', () => {
            const index: import('../../models/Timestamp').TimestampIndex = {
                documentUri: 'uri',
                format: { name: 'test', regex: /x/, captureGroup: 0, parse: () => new Date() },
                firstTime: new Date(),
                lastTime: new Date(),
                totalLines: 0,
                lineTimestamps: new Map(),
                hourBuckets: [],
            };
            assert.strictEqual(service.formatStatusBarText(index), '');
        });
    });

    // ── Step 7: Binary Search ──

    suite('findLineByTime', () => {
        test('exact match returns that line number', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:01.000  1234  5678 D Tag: b',
                '03-30 10:00:02.000  1234  5678 D Tag: c',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const target = index.lineTimestamps.get(1)!;
            assert.strictEqual(service.findLineByTime(index, target), 1);
        });

        test('between two lines returns nearest preceding line', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:10.000  1234  5678 D Tag: b',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            // Target is 5 seconds in — between line 0 and line 1
            const target = new Date(index.lineTimestamps.get(0)!.getTime() + 5000);
            assert.strictEqual(service.findLineByTime(index, target), 0);
        });

        test('before first timestamp returns first line', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:01.000  1234  5678 D Tag: b',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const target = new Date(index.firstTime.getTime() - 60000);
            assert.strictEqual(service.findLineByTime(index, target), 0);
        });

        test('after last timestamp returns last timestamped line', () => {
            const lines = [
                '03-30 10:00:00.000  1234  5678 D Tag: a',
                '03-30 10:00:01.000  1234  5678 D Tag: b',
            ];
            const fmt = service.detectFormat(lines)!;
            const index = service.buildIndex(lines, fmt, 'uri');
            const target = new Date(index.lastTime.getTime() + 60000);
            assert.strictEqual(service.findLineByTime(index, target), 1);
        });

        test('empty index returns -1', () => {
            const index: import('../../models/Timestamp').TimestampIndex = {
                documentUri: 'uri',
                format: { name: 'test', regex: /x/, captureGroup: 0, parse: () => new Date() },
                firstTime: new Date(),
                lastTime: new Date(),
                totalLines: 0,
                lineTimestamps: new Map(),
                hourBuckets: [],
            };
            assert.strictEqual(service.findLineByTime(index, new Date()), -1);
        });
    });

    // ── Step 8: Index Cache ──

    suite('index cache', () => {
        const logLines = [
            '03-30 10:00:00.000  1234  5678 D Tag: a',
            '03-30 10:00:01.000  1234  5678 D Tag: b',
        ];

        test('getIndex returns undefined for unknown URI', () => {
            assert.strictEqual(service.getIndex('unknown-uri'), undefined);
        });

        test('buildIndex stores result in cache, getIndex returns it', () => {
            const fmt = service.detectFormat(logLines)!;
            const index = service.buildIndex(logLines, fmt, 'cache-uri');
            const cached = service.getIndex('cache-uri');
            assert.strictEqual(cached, index);
        });

        test('invalidateIndex removes cached entry', () => {
            const fmt = service.detectFormat(logLines)!;
            service.buildIndex(logLines, fmt, 'inv-uri');
            assert.ok(service.getIndex('inv-uri'));
            service.invalidateIndex('inv-uri');
            assert.strictEqual(service.getIndex('inv-uri'), undefined);
        });

        test('invalidateIndex on unknown URI does not throw', () => {
            assert.doesNotThrow(() => service.invalidateIndex('no-such-uri'));
        });

        test('cache evicts oldest entry when exceeding max size', () => {
            const fmt = service.detectFormat(logLines)!;
            // Fill cache beyond default max (10)
            for (let i = 0; i < 12; i++) {
                service.buildIndex(logLines, fmt, `evict-uri-${i}`);
            }
            // Oldest entries should be evicted
            assert.strictEqual(service.getIndex('evict-uri-0'), undefined);
            assert.strictEqual(service.getIndex('evict-uri-1'), undefined);
            // Recent entries should remain
            assert.ok(service.getIndex('evict-uri-11'));
        });

        test('rebuilding same URI updates cache', () => {
            const fmt = service.detectFormat(logLines)!;
            const index1 = service.buildIndex(logLines, fmt, 'update-uri');
            const moreLines = [...logLines, '03-30 10:00:02.000  1234  5678 D Tag: c'];
            const index2 = service.buildIndex(moreLines, fmt, 'update-uri');
            assert.notStrictEqual(index1, index2);
            assert.strictEqual(service.getIndex('update-uri'), index2);
            assert.strictEqual(index2.lineTimestamps.size, 3);
        });
    });

    // ── parseLine ──

    suite('parseLine', () => {
        test('returns Date for line with logcat timestamp', () => {
            const fmt = service.detectFormat([
                '03-30 14:30:05.123  1234  5678 D Tag: msg',
            ])!;
            const result = service.parseLine('03-30 14:30:05.123  1234  5678 D Tag: msg', fmt);
            assert.ok(result instanceof Date);
            assert.strictEqual(result.getHours(), 14);
            assert.strictEqual(result.getMinutes(), 30);
            assert.strictEqual(result.getSeconds(), 5);
        });

        test('returns undefined for line without timestamp', () => {
            const fmt = service.detectFormat([
                '03-30 14:30:05.123  1234  5678 D Tag: msg',
            ])!;
            assert.strictEqual(service.parseLine('no timestamp here', fmt), undefined);
        });

        test('returns Date for iso8601 format', () => {
            const fmt = service.detectFormat([
                '2026-03-30T14:30:05.000Z INFO message',
            ])!;
            const result = service.parseLine('2026-03-30T14:30:05.000Z INFO message', fmt);
            assert.ok(result instanceof Date);
        });
    });

    // ── filterLinesByTimeRange ──

    suite('filterLinesByTimeRange', () => {
        const logcatLines = [
            '03-30 10:00:00.000  1234  5678 D Tag: line0',
            '03-30 10:05:00.000  1234  5678 D Tag: line1',
            '  continuation without timestamp',
            '03-30 10:10:00.000  1234  5678 D Tag: line3',
            '03-30 10:15:00.000  1234  5678 D Tag: line4',
            '03-30 10:20:00.000  1234  5678 D Tag: line5',
        ];

        function makeDate(h: number, m: number): Date {
            const d = new Date();
            d.setMonth(2, 30); // March 30
            d.setHours(h, m, 0, 0);
            return d;
        }

        test('include range filters to matching lines only', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                logcatLines, fmt, makeDate(10, 5), makeDate(10, 10),
            );
            assert.strictEqual(result.filteredLines.length, 3);
            assert.ok(result.filteredLines[0].includes('line1'));
            assert.ok(result.filteredLines[1].includes('continuation'));
            assert.ok(result.filteredLines[2].includes('line3'));
            assert.deepStrictEqual(result.lineMapping, [1, 2, 3]);
        });

        test('includes context lines without timestamps', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                logcatLines, fmt, makeDate(10, 5), makeDate(10, 5),
            );
            // line1 + continuation (inherits line1 timestamp which is in range)
            assert.strictEqual(result.filteredLines.length, 2);
            assert.ok(result.filteredLines[0].includes('line1'));
            assert.ok(result.filteredLines[1].includes('continuation'));
        });

        test('trim before: no startTime includes everything up to endTime', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                logcatLines, fmt, undefined, makeDate(10, 5),
            );
            assert.strictEqual(result.filteredLines.length, 3);
            assert.ok(result.filteredLines[0].includes('line0'));
            assert.ok(result.filteredLines[1].includes('line1'));
            assert.ok(result.filteredLines[2].includes('continuation'));
        });

        test('trim after: no endTime includes everything from startTime', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                logcatLines, fmt, makeDate(10, 15), undefined,
            );
            assert.strictEqual(result.filteredLines.length, 2);
            assert.ok(result.filteredLines[0].includes('line4'));
            assert.ok(result.filteredLines[1].includes('line5'));
        });

        test('both undefined returns all lines', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                logcatLines, fmt, undefined, undefined,
            );
            assert.strictEqual(result.filteredLines.length, logcatLines.length);
        });

        test('empty lines array returns empty result', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                [], fmt, makeDate(10, 0), makeDate(10, 20),
            );
            assert.strictEqual(result.filteredLines.length, 0);
            assert.strictEqual(result.lineMapping.length, 0);
        });

        test('range outside data returns empty result', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                logcatLines, fmt, makeDate(12, 0), makeDate(13, 0),
            );
            assert.strictEqual(result.filteredLines.length, 0);
        });

        test('lineMapping contains correct 0-based source indices', () => {
            const fmt = service.detectFormat(logcatLines)!;
            const result = service.filterLinesByTimeRange(
                logcatLines, fmt, makeDate(10, 10), makeDate(10, 15),
            );
            // line3 (index 3) and line4 (index 4)
            assert.deepStrictEqual(result.lineMapping, [3, 4]);
        });
    });

    // ── parseTimeInput ──

    suite('parseTimeInput', () => {
        const refDate = new Date(2026, 2, 30, 0, 0, 0, 0); // 2026-03-30
        const cursorTime = new Date(2026, 2, 30, 14, 30, 0, 0); // 14:30:00

        test('parses HH:MM', () => {
            const result = service.parseTimeInput('14:32', refDate);
            assert.ok(result);
            assert.strictEqual(result.getHours(), 14);
            assert.strictEqual(result.getMinutes(), 32);
            assert.strictEqual(result.getSeconds(), 0);
            assert.strictEqual(result.getMilliseconds(), 0);
        });

        test('parses HH:MM:SS', () => {
            const result = service.parseTimeInput('14:32:15', refDate);
            assert.ok(result);
            assert.strictEqual(result.getHours(), 14);
            assert.strictEqual(result.getMinutes(), 32);
            assert.strictEqual(result.getSeconds(), 15);
        });

        test('parses HH:MM:SS.mmm', () => {
            const result = service.parseTimeInput('14:32:15.123', refDate);
            assert.ok(result);
            assert.strictEqual(result.getMilliseconds(), 123);
        });

        test('parses HH:MM:SS.m (pads to milliseconds)', () => {
            const result = service.parseTimeInput('14:32:15.1', refDate);
            assert.ok(result);
            assert.strictEqual(result.getMilliseconds(), 100);
        });

        test('parses single-digit hour', () => {
            const result = service.parseTimeInput('9:05', refDate);
            assert.ok(result);
            assert.strictEqual(result.getHours(), 9);
            assert.strictEqual(result.getMinutes(), 5);
        });

        test('uses reference date for absolute time', () => {
            const result = service.parseTimeInput('14:32', refDate);
            assert.ok(result);
            assert.strictEqual(result.getFullYear(), 2026);
            assert.strictEqual(result.getMonth(), 2); // March (0-based)
            assert.strictEqual(result.getDate(), 30);
        });

        test('returns undefined for invalid hours', () => {
            assert.strictEqual(service.parseTimeInput('25:00', refDate), undefined);
        });

        test('returns undefined for invalid minutes', () => {
            assert.strictEqual(service.parseTimeInput('14:60', refDate), undefined);
        });

        test('returns undefined for empty string', () => {
            assert.strictEqual(service.parseTimeInput('', refDate), undefined);
        });

        test('returns undefined for garbage input', () => {
            assert.strictEqual(service.parseTimeInput('hello', refDate), undefined);
        });

        test('parses +5m relative time', () => {
            const result = service.parseTimeInput('+5m', refDate, cursorTime);
            assert.ok(result);
            assert.strictEqual(result.getHours(), 14);
            assert.strictEqual(result.getMinutes(), 35);
        });

        test('parses -30s relative time', () => {
            const result = service.parseTimeInput('-30s', refDate, cursorTime);
            assert.ok(result);
            assert.strictEqual(result.getHours(), 14);
            assert.strictEqual(result.getMinutes(), 29);
            assert.strictEqual(result.getSeconds(), 30);
        });

        test('parses +1h relative time', () => {
            const result = service.parseTimeInput('+1h', refDate, cursorTime);
            assert.ok(result);
            assert.strictEqual(result.getHours(), 15);
            assert.strictEqual(result.getMinutes(), 30);
        });

        test('parses +100ms relative time', () => {
            const result = service.parseTimeInput('+100ms', refDate, cursorTime);
            assert.ok(result);
            assert.strictEqual(result.getTime(), cursorTime.getTime() + 100);
        });

        test('relative time returns undefined without cursorTime', () => {
            assert.strictEqual(service.parseTimeInput('+5m', refDate), undefined);
        });

        test('trims whitespace', () => {
            const result = service.parseTimeInput('  14:32  ', refDate);
            assert.ok(result);
            assert.strictEqual(result.getHours(), 14);
            assert.strictEqual(result.getMinutes(), 32);
        });
    });
});
