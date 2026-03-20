import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { Logger } from '../../services/Logger';
import { RunbookService } from '../../services/RunbookService';
import { RunbookGroup, RunbookMarkdown } from '../../models/Runbook';

suite('RunbookService Test Suite', () => {
    let service: RunbookService;
    let tempDir: string;
    let context: vscode.ExtensionContext;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-test-'));
        const globalStoragePath = path.join(tempDir, 'globalStorage');
        fs.mkdirSync(globalStoragePath, { recursive: true });

        context = {
            globalStorageUri: vscode.Uri.file(globalStoragePath),
            extension: { packageJSON: { version: '1.0.0-test' } },
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        service = new RunbookService(context, Logger.getInstance());
        await service.ready;
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    suite('Initialization', () => {
        test('Should create runbooks directory on first init', () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            assert.ok(fs.existsSync(runbooksDir), 'runbooks directory should exist');
        });

        test('Should create default System Check folder with health-check.md file', () => {
            const defaultFolder = path.join(tempDir, 'globalStorage', 'runbooks', 'System Check');
            assert.ok(fs.existsSync(defaultFolder), 'default System Check folder should exist');

            const defaultFile = path.join(defaultFolder, 'health-check.md');
            assert.ok(fs.existsSync(defaultFile), 'default health-check.md should exist inside System Check folder');

            const content = fs.readFileSync(defaultFile, 'utf-8');
            assert.ok(content.includes('# System Health Check'), 'default content should include title');
            assert.ok(content.includes('```sh'), 'default content should include shell code block');
        });

        test('Should load default items after init', () => {
            const items = service.items;
            assert.ok(items.length > 0, 'should have at least one item');

            const group = items.find(i => i.label === 'System Check');
            assert.ok(group, 'should have System Check group');
            assert.strictEqual(group!.kind, 'group');

            const children = (group as RunbookGroup).children;
            const item = children.find(i => i.label === 'health-check');
            assert.ok(item, 'should have health-check item inside System Check group');
            assert.strictEqual(item!.kind, 'markdown');
        });

        test('Should not recreate default config if runbooks dir already exists', async () => {
            // Create a second service with same context - should not fail
            const service2 = new RunbookService(context, Logger.getInstance());
            await service2.ready;
            const items = service2.items;
            // Should still have the adb item from the first init
            assert.ok(items.length > 0);
        });
    });

    suite('loadConfig / scanDir', () => {
        test('Should scan directories as groups at root', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'mygroup');
            fs.mkdirSync(groupDir, { recursive: true });

            await service.loadConfig();
            const items = service.items;

            const groupItem = items.find(i => i.label === 'mygroup');
            assert.ok(groupItem, 'should find mygroup directory');
            assert.strictEqual(groupItem!.kind, 'group');
            assert.strictEqual((groupItem as RunbookGroup).dirPath, groupDir);
        });

        test('Should scan markdown files inside groups', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'mygroup');
            fs.mkdirSync(groupDir, { recursive: true });
            fs.writeFileSync(path.join(groupDir, 'test.md'), '# Test', 'utf-8');

            await service.loadConfig();
            const items = service.items;

            const groupItem = items.find(i => i.label === 'mygroup') as RunbookGroup;
            assert.ok(groupItem, 'should find mygroup directory');
            const testItem = groupItem.children.find(i => i.label === 'test');
            assert.ok(testItem, 'should find test.md inside group');
            assert.strictEqual(testItem!.kind, 'markdown');
            assert.strictEqual((testItem as RunbookMarkdown).filePath, path.join(groupDir, 'test.md'));
        });

        test('Should ignore standalone markdown files at root level', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            fs.writeFileSync(path.join(runbooksDir, 'standalone.md'), '# Standalone', 'utf-8');

            await service.loadConfig();
            const items = service.items;

            const standaloneItem = items.find(i => i.label === 'standalone');
            assert.strictEqual(standaloneItem, undefined, 'should not include standalone .md files at root');
        });

        test('Should ignore subdirectories inside groups', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'mygroup');
            const subDir = path.join(groupDir, 'subdir');
            fs.mkdirSync(subDir, { recursive: true });

            await service.loadConfig();
            const groupItem = service.items.find(i => i.label === 'mygroup') as RunbookGroup;
            assert.ok(groupItem, 'should find mygroup directory');
            const subDirItem = groupItem.children.find(i => i.label === 'subdir');
            assert.strictEqual(subDirItem, undefined, 'should not include subdirectories inside groups');
        });

        test('Should handle empty runbooks directory', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            fs.rmSync(runbooksDir, { recursive: true, force: true });
            fs.mkdirSync(runbooksDir, { recursive: true });

            await service.loadConfig();
            assert.strictEqual(service.items.length, 0);
        });
    });

    suite('createGroup', () => {
        test('Should create a group at root level', async () => {
            await service.createGroup('newgroup');
            const items = service.items;

            const group = items.find(i => i.label === 'newgroup');
            assert.ok(group, 'should create new group');
            assert.strictEqual(group!.kind, 'group');

            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            assert.ok(fs.existsSync(path.join(runbooksDir, 'newgroup')));
        });

        test('Should not overwrite existing group', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'existing');
            fs.mkdirSync(groupDir);
            fs.writeFileSync(path.join(groupDir, 'keep.md'), '# Keep', 'utf-8');

            await service.createGroup('existing');

            // The file inside should still exist
            assert.ok(fs.existsSync(path.join(groupDir, 'keep.md')));
        });
    });

    suite('createItem', () => {
        test('Should create a markdown item inside a group', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'mygroup');
            fs.mkdirSync(groupDir, { recursive: true });

            await service.createItem(groupDir, 'newfile');

            const filePath = path.join(groupDir, 'newfile.md');
            assert.ok(fs.existsSync(filePath), 'should create newfile.md');

            const content = fs.readFileSync(filePath, 'utf-8');
            assert.ok(content.includes('# New Runbook'), 'should have default content');
        });

        test('Should auto-append .md extension', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'mygroup');
            fs.mkdirSync(groupDir, { recursive: true });

            await service.createItem(groupDir, 'noext');
            assert.ok(fs.existsSync(path.join(groupDir, 'noext.md')));
        });

        test('Should not double .md extension', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'mygroup');
            fs.mkdirSync(groupDir, { recursive: true });

            await service.createItem(groupDir, 'already.md');
            assert.ok(fs.existsSync(path.join(groupDir, 'already.md')));
            assert.ok(!fs.existsSync(path.join(groupDir, 'already.md.md')));
        });

        test('Should not overwrite existing item', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'mygroup');
            fs.mkdirSync(groupDir, { recursive: true });
            const existingPath = path.join(groupDir, 'existing.md');
            fs.writeFileSync(existingPath, '# Existing Content', 'utf-8');

            await service.createItem(groupDir, 'existing');

            const content = fs.readFileSync(existingPath, 'utf-8');
            assert.strictEqual(content, '# Existing Content', 'should not overwrite');
        });
    });

    suite('renamePath', () => {
        test('Should rename a markdown file', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const oldPath = path.join(runbooksDir, 'old.md');
            fs.writeFileSync(oldPath, '# Old', 'utf-8');

            await service.renamePath(oldPath, 'renamed', false);

            assert.ok(!fs.existsSync(oldPath), 'old file should not exist');
            assert.ok(fs.existsSync(path.join(runbooksDir, 'renamed.md')), 'renamed file should exist');
        });

        test('Should auto-append .md for markdown rename', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const oldPath = path.join(runbooksDir, 'before.md');
            fs.writeFileSync(oldPath, '# Before', 'utf-8');

            await service.renamePath(oldPath, 'after', false);
            assert.ok(fs.existsSync(path.join(runbooksDir, 'after.md')));
        });

        test('Should rename a group directory', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const oldDir = path.join(runbooksDir, 'oldgroup');
            fs.mkdirSync(oldDir);

            await service.renamePath(oldDir, 'newgroup', true);

            assert.ok(!fs.existsSync(oldDir), 'old dir should not exist');
            assert.ok(fs.existsSync(path.join(runbooksDir, 'newgroup')), 'new dir should exist');
        });

        test('Should not rename if name is the same', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const filePath = path.join(runbooksDir, 'same.md');
            fs.writeFileSync(filePath, '# Same', 'utf-8');

            // same.md -> same (will become same.md, same path)
            await service.renamePath(filePath, 'same', false);
            assert.ok(fs.existsSync(filePath), 'file should still exist');
        });
    });

    suite('deletePath', () => {
        test('Should delete a markdown file', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const filePath = path.join(runbooksDir, 'todelete.md');
            fs.writeFileSync(filePath, '# Delete Me', 'utf-8');

            await service.deletePath(filePath);
            assert.ok(!fs.existsSync(filePath), 'file should be deleted');
        });

        test('Should delete a group directory recursively', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'deletegroup');
            fs.mkdirSync(groupDir);
            fs.writeFileSync(path.join(groupDir, 'inner.md'), '# Inner', 'utf-8');

            await service.deletePath(groupDir);
            assert.ok(!fs.existsSync(groupDir), 'group should be deleted');
        });

        test('Should handle non-existent path gracefully', async () => {
            const fakePath = path.join(tempDir, 'globalStorage', 'runbooks', 'nonexistent.md');
            // Should not throw
            await service.deletePath(fakePath);
        });
    });

    suite('refresh', () => {
        test('Should reload items and fire change event', async () => {
            let eventFired = false;
            service.onDidChangeTreeData(() => { eventFired = true; });

            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            const groupDir = path.join(runbooksDir, 'newgroup');
            fs.mkdirSync(groupDir, { recursive: true });
            fs.writeFileSync(path.join(groupDir, 'new.md'), '# New', 'utf-8');

            await service.refresh();

            assert.ok(eventFired, 'change event should fire');
            const newGroup = service.items.find(i => i.label === 'newgroup') as RunbookGroup;
            assert.ok(newGroup, 'new group should be found after refresh');
            const newItem = newGroup.children.find(i => i.label === 'new');
            assert.ok(newItem, 'new item should be found inside group after refresh');
        });
    });

    suite('Export / Import', () => {
        test('Should serialize items for export', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            // Clear and set up known state
            fs.rmSync(runbooksDir, { recursive: true, force: true });
            fs.mkdirSync(runbooksDir, { recursive: true });

            const groupDir = path.join(runbooksDir, 'group1');
            fs.mkdirSync(groupDir);
            fs.writeFileSync(path.join(groupDir, 'doc1.md'), '# Doc 1 Content', 'utf-8');
            fs.writeFileSync(path.join(groupDir, 'doc2.md'), '# Doc 2 Content', 'utf-8');

            await service.loadConfig();

            // Export to a temp file
            const exportPath = path.join(tempDir, 'export.json');
            const exportUri = vscode.Uri.file(exportPath);

            await service.exportRunbook(exportUri);

            assert.ok(fs.existsSync(exportPath), 'export file should exist');
            const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
            assert.strictEqual(exported.version, '1.0.0-test');
            assert.ok(Array.isArray(exported.runbooks));

            // Should have group1 with children
            const group = exported.runbooks.find((r: { name: string }) => r.name === 'group1');
            assert.ok(group, 'exported should contain group1');
            assert.strictEqual(group.type, 'group');
            assert.ok(group.children.length === 2, 'group1 should have 2 children');

            const doc1 = group.children.find((r: { name: string }) => r.name === 'doc1');
            assert.ok(doc1, 'exported group should contain doc1');
            assert.strictEqual(doc1.type, 'markdown');
            assert.strictEqual(doc1.content, '# Doc 1 Content');
        });

        test('Should import runbooks from JSON', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            // Clear existing
            fs.rmSync(runbooksDir, { recursive: true, force: true });
            fs.mkdirSync(runbooksDir, { recursive: true });

            const importData = {
                version: '1.0.0',
                runbooks: [
                    { type: 'markdown', name: 'imported_doc', content: '# Imported' },
                    {
                        type: 'group', name: 'imported_group', children: [
                            { type: 'markdown', name: 'nested_doc', content: '# Nested' }
                        ]
                    }
                ]
            };

            const importPath = path.join(tempDir, 'import.json');
            fs.writeFileSync(importPath, JSON.stringify(importData), 'utf-8');

            await service.importRunbook(vscode.Uri.file(importPath));

            // Verify files were created
            assert.ok(fs.existsSync(path.join(runbooksDir, 'imported_doc.md')));
            assert.ok(fs.existsSync(path.join(runbooksDir, 'imported_group')));
            assert.ok(fs.existsSync(path.join(runbooksDir, 'imported_group', 'nested_doc.md')));

            const content = fs.readFileSync(path.join(runbooksDir, 'imported_doc.md'), 'utf-8');
            assert.strictEqual(content, '# Imported');
        });

        test('Should handle import with .md extension in name', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');

            const importData = {
                version: '1.0.0',
                runbooks: [
                    { type: 'markdown', name: 'hasext.md', content: '# Has Extension' }
                ]
            };

            const importPath = path.join(tempDir, 'import2.json');
            fs.writeFileSync(importPath, JSON.stringify(importData), 'utf-8');

            await service.importRunbook(vscode.Uri.file(importPath));

            // Should not create hasext.md.md
            assert.ok(fs.existsSync(path.join(runbooksDir, 'hasext.md')));
            assert.ok(!fs.existsSync(path.join(runbooksDir, 'hasext.md.md')));
        });

        test('Should reject invalid import format', async () => {
            const importPath = path.join(tempDir, 'invalid.json');
            fs.writeFileSync(importPath, JSON.stringify({ invalid: true }), 'utf-8');

            // Should not throw, but also not import anything new
            const itemsBefore = service.items.length;
            await service.importRunbook(vscode.Uri.file(importPath));
            // Items count should remain the same (import fails gracefully)
            assert.strictEqual(service.items.length, itemsBefore);
        });

        test('Should handle empty content in markdown import', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');

            const importData = {
                version: '1.0.0',
                runbooks: [
                    { type: 'markdown', name: 'empty', content: '' }
                ]
            };

            const importPath = path.join(tempDir, 'empty_import.json');
            fs.writeFileSync(importPath, JSON.stringify(importData), 'utf-8');

            await service.importRunbook(vscode.Uri.file(importPath));

            const filePath = path.join(runbooksDir, 'empty.md');
            assert.ok(fs.existsSync(filePath));
            assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), '');
        });

        test('Should skip items with missing type or name during import', async () => {
            const runbooksDir = path.join(tempDir, 'globalStorage', 'runbooks');
            // Clear existing
            fs.rmSync(runbooksDir, { recursive: true, force: true });
            fs.mkdirSync(runbooksDir, { recursive: true });

            const importData = {
                version: '1.0.0',
                runbooks: [
                    { type: 'markdown', name: '' },           // empty name
                    { type: '', name: 'noType' },             // empty type
                    { name: 'missingType' },                  // no type
                    { type: 'markdown' },                     // no name
                    {
                        type: 'group', name: 'validGroup', children: [
                            { type: 'markdown', name: 'valid', content: '# Valid' }
                        ]
                    }
                ]
            };

            const importPath = path.join(tempDir, 'partial.json');
            fs.writeFileSync(importPath, JSON.stringify(importData), 'utf-8');

            await service.importRunbook(vscode.Uri.file(importPath));

            await service.loadConfig();
            const validGroup = service.items.find(i => i.label === 'validGroup') as RunbookGroup;
            assert.ok(validGroup, 'valid group should be imported');
            const validItem = validGroup.children.find(i => i.label === 'valid');
            assert.ok(validItem, 'valid item should be imported inside group');
        });
    });
});
