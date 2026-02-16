import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { LogProcessor } from '../../services/LogProcessor';
import { FilterGroup, FilterItem, FilterType } from '../../models/Filter';
// Mock VS Codde

/**
 * LogProcessor Integration Test Suite
 *
 * Verifies the end-to-end log processing and filtering logic using real file I/O.
 * Uses a sample log file (src/test/resources/sample.log) and expected output.
 */
suite('LogProcessor Integration Test Suite', () => {
    let processor: LogProcessor;
    const resourcesDir = path.join(__dirname, '..', '..', '..', 'src', 'test', 'resources');
    const sampleLogPath = path.join(resourcesDir, 'sample.log');
    const expectedOutputPath = path.join(resourcesDir, 'expected_filtered.log');

    // Helper to create a basic filter group
    function createGroup(id: string, name: string, enabled: boolean = true): FilterGroup {
        return {
            id,
            name,
            filters: [],
            isEnabled: enabled,
            isRegex: false,
            isExpanded: true
        };
    }

    // Helper to create a filter item
    function createFilter(id: string, keyword: string, type: FilterType, enabled: boolean = true, isRegex: boolean = false, contextLine: number = 0, caseSensitive: boolean = false): FilterItem {
        return {
            id,
            keyword,
            type,
            isEnabled: enabled,
            isRegex,
            contextLine,
            caseSensitive
        };
    }

    setup(() => {
        processor = new LogProcessor();
    });

    test('processFile: should correctly filter log file based on "Error" keyword', async () => {
        const filterGroup = createGroup('test-group', 'Test Group');
        filterGroup.filters.push(createFilter('filter-1', 'Error', 'include'));

        const result = await processor.processFile(sampleLogPath, [filterGroup]);

        assert.ok(result.processed > 0, 'Should have processed lines');
        assert.strictEqual(result.matched, 2, 'Should match 2 lines');

        const actualContent = fs.readFileSync(result.outputPath, 'utf8');
        const expectedContent = fs.readFileSync(expectedOutputPath, 'utf8');
        assert.strictEqual(actualContent.trim(), expectedContent.trim(), 'Filtered output should match expected content');

        if (fs.existsSync(result.outputPath)) {
            fs.unlinkSync(result.outputPath);
        }
    });

    test('processFile: Case Sensitivity', async () => {
        const filterGroup = createGroup('case-group', 'Case Group');

        // 1. Case Sensitive "error" (should not match "ERROR")
        const caseSensitiveFilter = createFilter('filter-case', 'error', 'include', true, false, 0, true);

        filterGroup.filters = [caseSensitiveFilter];

        const result1 = await processor.processFile(sampleLogPath, [filterGroup]);
        assert.strictEqual(result1.matched, 0, 'Should match 0 lines for case-sensitive lowercase "error"');
        if (fs.existsSync(result1.outputPath)) {
            fs.unlinkSync(result1.outputPath);
        }

        // 2. Case Insensitive "error" (should match "ERROR")
        caseSensitiveFilter.caseSensitive = false;
        const result2 = await processor.processFile(sampleLogPath, [filterGroup]);
        assert.strictEqual(result2.matched, 2, 'Should match 2 lines for case-insensitive "error"');
        if (fs.existsSync(result2.outputPath)) {
            fs.unlinkSync(result2.outputPath);
        }
    });

    test('processFile: Include and Exclude combination', async () => {
        // Include "INFO", Exclude "Network"
        // sample.log lines with INFO:
        // 1. INFO [Main] Application started
        // 2. INFO [Network] Connected  <-- Should be excluded
        // 3. INFO [DB] Retrying connection...
        // 4. INFO [Main] Shutting down
        // expected: 1, 3, 4 (Total 3)

        const filterGroup = createGroup('combo-group', 'Combo');
        filterGroup.filters.push(createFilter('include-info', 'INFO', 'include'));
        filterGroup.filters.push(createFilter('exclude-network', 'Network', 'exclude'));

        const result = await processor.processFile(sampleLogPath, [filterGroup]);
        assert.strictEqual(result.matched, 3, 'Should match 3 lines (INFO excluding Network)');

        if (fs.existsSync(result.outputPath)) {
            fs.unlinkSync(result.outputPath);
        }
    });

    test('processFile: Strict Group Logic (Group Enabled, Item Disabled)', async () => {
        const filterGroup = createGroup('toggle-group', 'Toggle');

        // Add disabled "ERROR" filter.
        // New Logic: Group is Enabled, but Item is Disabled -> Filter NOT applied.
        const disabledFilter = createFilter('disabled-error', 'ERROR', 'include', false);
        filterGroup.filters.push(disabledFilter);

        const result1 = await processor.processFile(sampleLogPath, [filterGroup]);

        // Should match 7 lines (ALL) because Item is Disabled -> No active filters -> Show All.
        assert.strictEqual(result1.matched, 7, 'Should match all (7) lines because Item is Disabled');

        if (fs.existsSync(result1.outputPath)) {
            fs.unlinkSync(result1.outputPath);
        }
    });

    test('processFile: Multiple Groups (Strict Group Enable)', async () => {
        // Group 1: Enabled, Include "ERROR" (Matches 2)
        const group1 = createGroup('g1', 'Enabled Group', true);
        group1.filters.push(createFilter('f1', 'ERROR', 'include'));

        // Group 2: Disabled, Include "INFO" (Matches 4)
        // Group Disabled -> Filters inside are IGNORED, even if item isEnabled=true.
        const group2 = createGroup('g2', 'Disabled Group', false); // Enabled = false
        group2.filters.push(createFilter('f2', 'INFO', 'include', true)); // Explicitly enabled item

        const result = await processor.processFile(sampleLogPath, [group1, group2]);

        // Should ONLY apply Group 1 (ERROR) since Group 2 is disabled.
        // Expected matches: 2 (ERROR lines only)
        assert.strictEqual(result.matched, 2, 'Should only match Group 1 because Group 2 is disabled');
        if (fs.existsSync(result.outputPath)) {
            fs.unlinkSync(result.outputPath);
        }

        // Sub-test: Disable the item in Group 2 (redundant, but tests further changes)
        group2.filters[0].isEnabled = false;
        const result2 = await processor.processFile(sampleLogPath, [group1, group2]);

        // Now Item is Disabled AND Group is Disabled.
        // Should continue to only match Group 1 (ERROR) -> 2 matches.
        assert.strictEqual(result2.matched, 2, 'Should only match Group 1 when Group 2 and its item are disabled');
        if (fs.existsSync(result2.outputPath)) {
            fs.unlinkSync(result2.outputPath);
        }
    });

    test('processFile: Context Lines', async () => {
        // Filter "Retrying" (Line 5 in sample.log) with context 1.
        // Line 4: 2023-10-27 10:00:02.000 ERROR [DB] Connection failed
        // Line 5: 2023-10-27 10:00:02.100 INFO  [DB] Retrying connection...
        // Line 6: 2023-10-27 10:00:03.000 ERROR [DB] Connection failed again

        // Should output lines 4, 5, 6. Total 3 lines.

        const filterGroup = createGroup('context-group', 'Context');
        const contextFilter = createFilter('f-context', 'Retrying', 'include');
        contextFilter.contextLine = 1;
        filterGroup.filters.push(contextFilter);

        const result = await processor.processFile(sampleLogPath, [filterGroup]);

        assert.strictEqual(result.matched, 1, 'Should register 1 primary match');
        // Note: result.matched counts the primary matches. The output file line count includes context.
        // Let's verify output line count.

        const content = fs.readFileSync(result.outputPath, 'utf8').trim().split('\n');
        assert.strictEqual(content.length, 3, 'Output should verify 3 lines (1 match + 1 before + 1 after)');
        assert.ok(content[0].includes('Connection failed'), 'Line before');
        assert.ok(content[1].includes('Retrying'), 'Match line');
        assert.ok(content[2].includes('Connection failed again'), 'Line after');

        if (fs.existsSync(result.outputPath)) {
            fs.unlinkSync(result.outputPath);
        }
    });

    test('processFile: Android Log Test', async () => {
        const androidLogPath = path.join(resourcesDir, 'test_log_android.log');
        const androidGroupPath = path.join(resourcesDir, 'test_group_android.json');
        const androidExpectedPath = path.join(resourcesDir, 'test_log_android_filtered.log');

        // 1. Load Filter Params
        const groupContent = fs.readFileSync(androidGroupPath, 'utf8');
        const parsedContext = JSON.parse(groupContent);
        const groups = parsedContext.groups as FilterGroup[];

        // 2. Process
        const result = await processor.processFile(androidLogPath, groups);

        // 3. Verify
        assert.ok(result.processed > 0, 'Should handle 200~ lines');

        const actualContent = fs.readFileSync(result.outputPath, 'utf8');
        const expectedContent = fs.readFileSync(androidExpectedPath, 'utf8');

        // Normalize line endings for cross-platform comparison if needed, though usually trim() helps.
        assert.strictEqual(actualContent.trim(), expectedContent.trim(), 'Android filtered output should match');

        if (fs.existsSync(result.outputPath)) {
            fs.unlinkSync(result.outputPath);
        }
    });
});
