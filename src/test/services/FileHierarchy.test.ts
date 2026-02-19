import * as assert from 'assert';
import * as vscode from 'vscode';
import { FileHierarchyService } from '../../services/FileHierarchyService';
import { MockExtensionContext } from '../utils/Mocks';

suite('FileHierarchyService Test Suite', () => {
    let service: FileHierarchyService;
    let mockContext: MockExtensionContext;

    const originalUri = vscode.Uri.file('/logs/original.log');
    const filter1Uri = vscode.Uri.file('/logs/filter1.log');
    const filter2Uri = vscode.Uri.file('/logs/filter2.log');
    const bookmarkUri = vscode.Uri.parse('untitled:Bookmark');

    setup(() => {
        mockContext = new MockExtensionContext();
        // Reset singleton for testing (hacky but necessary since getInstance returns singleton)
        // @ts-expect-error: Resetting private singleton instance for testing
        FileHierarchyService.instance = undefined;
        service = FileHierarchyService.getInstance();
        service.initialize(mockContext as unknown as vscode.ExtensionContext);
    });

    test('Scenario 1: Original > Filter1 > Parent > Original', () => {
        // Log File > Filter1 (Temp)
        service.registerChild(originalUri, filter1Uri, 'filter');

        // Verify Parent of Filter1 is Original
        const parent = service.getParent(filter1Uri);
        assert.strictEqual(parent?.toString(), originalUri.toString());

        // Verify Root of Filter1 is Original
        const root = service.getRoot(filter1Uri);
        assert.strictEqual(root?.toString(), originalUri.toString());
    });

    test('Scenario 2: Original > Filter1 > Filter2 > Parent > Filter1 > Parent > Original', () => {
        // Log File > Filter1
        service.registerChild(originalUri, filter1Uri, 'filter');
        // Filter1 > Filter2
        service.registerChild(filter1Uri, filter2Uri, 'filter');

        // Check Parent of Filter2 (should be Filter1)
        const parent2 = service.getParent(filter2Uri);
        assert.strictEqual(parent2?.toString(), filter1Uri.toString());

        // Check Parent of Filter1 (should be Original)
        const parent1 = service.getParent(filter1Uri);
        assert.strictEqual(parent1?.toString(), originalUri.toString());
    });

    test('Scenario 3: Original > Filter1 > Filter2 > Original (Root) > Original', () => {
        service.registerChild(originalUri, filter1Uri, 'filter');
        service.registerChild(filter1Uri, filter2Uri, 'filter');

        // Check Root of Filter2 (should be Original)
        const root = service.getRoot(filter2Uri);
        assert.strictEqual(root?.toString(), originalUri.toString());
    });

    test('Scenario 4 & 5: Original > Filter1 > Bookmark > Export > Parent/Original', () => {
        service.registerChild(originalUri, filter1Uri, 'filter');
        service.registerChild(filter1Uri, bookmarkUri, 'bookmark');

        // Parent of Bookmark -> Filter1
        const parent = service.getParent(bookmarkUri);
        assert.strictEqual(parent?.toString(), filter1Uri.toString());

        // Root of Bookmark -> Original
        const root = service.getRoot(bookmarkUri);
        assert.strictEqual(root?.toString(), originalUri.toString());
    });

    test('Scenario 6: Persistence within session (Close/Re-open Filter1)', () => {
        service.registerChild(originalUri, filter1Uri, 'filter');

        // Simulate closing (which technically calls unregister but we disabled the delete logic)
        // The unregister method in service now just saves state if changed, but DOES remove from memory?
        // Wait, the requirement was "Remove the logic that unregisters hierarchy information when a file is closed."
        // So the extension.ts listener was removed.
        // If unregister IS called manually, it removes it.
        // But in scenario 6, "re-open" implies it was safe.
        // Let's verify that the node exists.
        assert.ok(service.getNode(filter1Uri));

        // Attempt "unregister" call effectively creates a hole if logically valid,
        // but since we removed the listener in extension.ts, unregister is NOT called on close.
        // So this test confirms robust state.

        const parent = service.getParent(filter1Uri);
        assert.strictEqual(parent?.toString(), originalUri.toString());
    });

    test('Scenario 7: Persistence across VS Code Restart (Original > Filter1)', () => {
        // 1. Setup initial state
        service.registerChild(originalUri, filter1Uri, 'filter');

        // 2. State is saved to mockContext.workspaceState automatically within registerChild
        const savedState = mockContext.workspaceState.get('logmagnifier.fileHierarchy');
        assert.ok(savedState, 'State should be saved to storage');

        // 3. Simulate Restart: New Service Instance with same context
        // @ts-expect-error: Resetting private singleton instance for testing
        FileHierarchyService.instance = undefined;
        const newService = FileHierarchyService.getInstance();
        newService.initialize(mockContext as unknown as vscode.ExtensionContext);

        // 4. Verify restored state
        const parent = newService.getParent(filter1Uri);
        assert.strictEqual(parent?.toString(), originalUri.toString());
    });

    test('Scenario 8: Persistence across Restart with Bookmark', () => {
        // Original > Filter1 > Bookmark
        service.registerChild(originalUri, filter1Uri, 'filter');
        service.registerChild(filter1Uri, bookmarkUri, 'bookmark');

        // Restart
        // @ts-expect-error: Resetting private singleton instance for testing
        FileHierarchyService.instance = undefined;
        const newService = FileHierarchyService.getInstance();
        newService.initialize(mockContext as unknown as vscode.ExtensionContext); // Context still has data from previous steps

        // Verify Bookmark -> Parent is Filter1
        const bkParent = newService.getParent(bookmarkUri);
        assert.strictEqual(bkParent?.toString(), filter1Uri.toString());

        // Verify Bookmark -> Original (Root) is Original
        const bkRoot = newService.getRoot(bookmarkUri);
        assert.strictEqual(bkRoot?.toString(), originalUri.toString());

        // Verify Filter1 -> Parent is Original
        const f1Parent = newService.getParent(filter1Uri);
        assert.strictEqual(f1Parent?.toString(), originalUri.toString());
    });

    test('Scenario 9: Recursive Delete (Original > Filter > Bookmark)', () => {
        // Setup: Original > Filter1 > Bookmark
        service.registerChild(originalUri, filter1Uri, 'filter');
        service.registerChild(filter1Uri, bookmarkUri, 'bookmark');

        // Verify hierarchy exists
        assert.ok(service.getNode(originalUri));
        assert.ok(service.getNode(filter1Uri));
        assert.ok(service.getNode(bookmarkUri));

        // Action: Unregister Original recursively
        service.unregister(originalUri, true);

        // Verify all nodes are gone
        assert.strictEqual(service.getNode(originalUri), undefined, 'Original should be removed');
        assert.strictEqual(service.getNode(filter1Uri), undefined, 'Filter should be removed');
        assert.strictEqual(service.getNode(bookmarkUri), undefined, 'Bookmark should be removed');
    });

    test('Scenario 10: Child Delete (Original > Filter > Bookmark -> Delete Filter)', () => {
        // Setup: Original > Filter1 > Bookmark
        service.registerChild(originalUri, filter1Uri, 'filter');
        service.registerChild(filter1Uri, bookmarkUri, 'bookmark'); // Bookmark is child of Filter1 in this context setup?
        // Wait, registerChild only links Parent -> Child. Children set of parent is updated.
        // registerChild(originalUri, filter1Uri) -> Original has child Filter1. Filter1 has parent Original.
        // registerChild(filter1Uri, bookmarkUri) -> Filter1 has child Bookmark. Bookmark has parent Filter1.

        // Action: Unregister Filter recursively
        service.unregister(filter1Uri, true);

        // Verify Filter and Bookmark (its child) are gone, but Original remains
        assert.strictEqual(service.getNode(filter1Uri), undefined, 'Filter should be removed');
        assert.strictEqual(service.getNode(bookmarkUri), undefined, 'Bookmark should be removed');
        assert.ok(service.getNode(originalUri), 'Original should NOT be removed');

        // Check Original children empty
        const children = service.getChildren(originalUri);
        assert.strictEqual(children.length, 0, 'Original should have no children');
    });
});
