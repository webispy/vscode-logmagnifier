import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { LogProcessor } from '../../services/LogProcessor';
import { FilteredLogDefinitionProvider } from '../../providers/FilteredLogDefinitionProvider';
import { SourceMapService } from '../../services/SourceMapService';
import { FilterGroup } from '../../models/Filter';

/**
 * FilteredLogDefinitionProvider Integration Test Suite
 *
 * Verifies that the Go to Definition feature correctly maps filtered log lines
 * back to their original locations in the source log file.
 */
suite('FilteredLogDefinitionProvider Integration Test Suite', () => {
    const resourcesDir = path.join(__dirname, '..', '..', '..', 'src', 'test', 'resources');
    const androidLogPath = path.join(resourcesDir, 'test_log_android.log');
    const androidGroupPath = path.join(resourcesDir, 'test_group_android.json');

    let processor: LogProcessor;
    let sourceMapService: SourceMapService;
    let definitionProvider: FilteredLogDefinitionProvider;

    setup(() => {
        processor = new LogProcessor();
        sourceMapService = SourceMapService.getInstance();
        definitionProvider = new FilteredLogDefinitionProvider(sourceMapService);
    });

    test('provideDefinition: should map filtered lines to correct original lines in Android log', async () => {
        // 1. Load Filter Groups
        const groupContent = fs.readFileSync(androidGroupPath, 'utf8');
        const parsed = JSON.parse(groupContent);
        const groups = parsed.groups as FilterGroup[];

        // 2. Process File to get line mapping
        // We use prependLineNumbers: false because that's the standard use case for definition provider
        const result = await processor.processFile(androidLogPath, groups, { prependLineNumbers: false });
        const filteredUri = vscode.Uri.file(result.outputPath);
        const sourceUri = vscode.Uri.file(androidLogPath);

        try {
            // 3. Register Mapping
            sourceMapService.register(filteredUri, sourceUri, result.lineMapping);

            // 4. Open the filtered document
            const document = await vscode.workspace.openTextDocument(filteredUri);

            // 5. Test specific lines
            // In test_log_android.log:
            // "Access denied" matches at original line 50 (index 49) and 54 (index 53).
            // "ime()" matches at original line 75 (index 74) with 3 context lines.

            // Let's verify the first few lines of the filtered output.
            // Result mapping should tell us what original line corresponds to filtered line 0.

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                if (i === document.lineCount - 1 && line.isEmptyOrWhitespace && i >= result.lineMapping.length) {
                    continue; // Skip trailing empty line
                }

                const position = new vscode.Position(i, 0);
                const definitions = await definitionProvider.provideDefinition(document, position, new vscode.CancellationTokenSource().token) as vscode.DefinitionLink[];

                assert.ok(definitions && definitions.length > 0, `Line ${i} should have a definition mapping (Content: "${line.text}")`);
                const def = definitions[0];

                assert.strictEqual(def.targetUri.toString(), sourceUri.toString(), `Line ${i} mapping should point to correct source URI`);

                const expectedOriginalLine = result.lineMapping[i];
                assert.strictEqual(def.targetRange.start.line, expectedOriginalLine, `Line ${i} should map to original line ${expectedOriginalLine}`);
            }

            // Verify a specific match known to be in test_log_android.log
            // Original line 50 (index 49) contains "Access denied"
            const filteredIndexForLine50 = result.lineMapping.indexOf(49);
            if (filteredIndexForLine50 !== -1) {
                const pos = new vscode.Position(filteredIndexForLine50, 5);
                const defs = await definitionProvider.provideDefinition(document, pos, new vscode.CancellationTokenSource().token) as vscode.DefinitionLink[];
                assert.strictEqual(defs[0].targetRange.start.line, 49, 'Match "Access denied" should map to index 49');
            }

        } finally {
            // Cleanup
            sourceMapService.unregister(filteredUri);
            if (fs.existsSync(result.outputPath)) {
                fs.unlinkSync(result.outputPath);
            }
        }
    });

    test('provideDefinition: should return undefined for document without mapping', async () => {
        const dummyUri = vscode.Uri.file(path.join(resourcesDir, 'dummy.log'));
        // Ensure dummy.log exists or use a mock
        const doc = await vscode.workspace.openTextDocument(androidLogPath); // reuse existing doc but check against dummy logic

        // Use a URI that is NOT registered
        const unregisteredUri = vscode.Uri.parse('file:///unregistered.log');
        // We can't easily "fake" the URI of an open document in VS Code API without saving it,
        // but FilteredLogDefinitionProvider checks document.uri.

        const result = await definitionProvider.provideDefinition(doc, new vscode.Position(0, 0), new vscode.CancellationTokenSource().token);
        assert.strictEqual(result, undefined, 'Should return undefined for unregistered document');
    });
});
