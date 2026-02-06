import * as vscode from 'vscode';
import * as path from 'path';

export interface HierarchyNode {
    uri: vscode.Uri;
    parentId?: string; // URI string
    children: Set<string>; // URI strings
    type: 'original' | 'filter' | 'bookmark';
    label: string;
}

export class FileHierarchyService {
    private static instance: FileHierarchyService;
    private nodes: Map<string, HierarchyNode> = new Map();
    private storage: vscode.Memento | undefined;
    private readonly STORAGE_KEY = 'logmagnifier.fileHierarchy';

    private _onDidChangeHierarchy: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeHierarchy: vscode.Event<void> = this._onDidChangeHierarchy.event;

    private constructor() { }

    public static getInstance(): FileHierarchyService {
        if (!FileHierarchyService.instance) {
            FileHierarchyService.instance = new FileHierarchyService();
        }
        return FileHierarchyService.instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        this.storage = context.workspaceState;
        this.restore();
    }

    private save() {
        if (this.storage) {
            // Convert Map to array of entries for JSON stringification
            // Set does not stringify well, convert to Array
            const entries = Array.from(this.nodes.entries()).map(([key, node]) => {
                return [key, {
                    ...node,
                    children: Array.from(node.children) // Convert Set to Array
                }];
            });
            this.storage.update(this.STORAGE_KEY, entries);
        }
    }

    private restore() {
        if (this.storage) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const entries = this.storage.get<[string, any][]>(this.STORAGE_KEY, []);
            this.nodes = new Map();

            for (const [key, rawNode] of entries) {
                // Re-hydrate URIs and Sets
                let uri: vscode.Uri;
                if (rawNode.uri && typeof rawNode.uri === 'object' && rawNode.uri.path) {
                    // Revive URI from object
                    uri = vscode.Uri.from(rawNode.uri);
                } else if (typeof rawNode.uri === 'string') {
                    uri = vscode.Uri.parse(rawNode.uri);
                } else {
                    // Fallback/Error?
                    continue;
                }

                this.nodes.set(key, {
                    uri: uri,
                    parentId: rawNode.parentId,
                    children: new Set(rawNode.children || []), // Convert Array back to Set
                    type: rawNode.type,
                    label: rawNode.label
                });
            }
        }
    }

    public registerChild(parentUri: vscode.Uri, childUri: vscode.Uri, type: 'filter' | 'bookmark', label?: string) {
        const parentKey = parentUri.toString();
        const childKey = childUri.toString();

        // Ensure parent exists
        if (!this.nodes.has(parentKey)) {
            this.nodes.set(parentKey, {
                uri: parentUri,
                children: new Set(),
                type: 'original',
                label: path.basename(parentUri.fsPath)
            });
        }

        const parentNode = this.nodes.get(parentKey)!;
        parentNode.children.add(childKey);

        // Register child
        this.nodes.set(childKey, {
            uri: childUri,
            parentId: parentKey,
            children: new Set(),
            type: type,
            label: label || path.basename(childUri.fsPath)
        });

        this.save();
        this._onDidChangeHierarchy.fire();
    }

    public unregister(uri: vscode.Uri) {
        const key = uri.toString();
        const node = this.nodes.get(key);

        if (node) {
            // Remove from parent's children
            if (node.parentId) {
                const parent = this.nodes.get(node.parentId);
                if (parent) {
                    parent.children.delete(key);
                }
            }
            // Remove node itself
            this.nodes.delete(key);

            // Recursively remove children ??
            // Policy: If a parent is closed/removed, do we remove children?
            // For now, let's keep it simple. Only remove if explicitly asked.

            this.save();
            this._onDidChangeHierarchy.fire();
        }
    }

    public getParent(uri: vscode.Uri): vscode.Uri | undefined {
        const node = this.nodes.get(uri.toString());
        if (node && node.parentId) {
            const parent = this.nodes.get(node.parentId);
            return parent ? parent.uri : vscode.Uri.parse(node.parentId);
        }
        return undefined;
    }

    public getRoot(uri: vscode.Uri): vscode.Uri | undefined {
        let current = this.nodes.get(uri.toString());
        if (!current) { return undefined; }

        while (current.parentId) {
            const parent = this.nodes.get(current.parentId);
            if (!parent) { break; }
            current = parent;
        }

        // If current is the node we started with and has no parent, it is the root (or just a standalone file)
        // But we want to return it only if it is part of a hierarchy?
        // Let's return it.
        return current.uri;
    }

    public getSiblings(uri: vscode.Uri): vscode.Uri[] {
        const node = this.nodes.get(uri.toString());
        if (!node || !node.parentId) { return []; }

        const parent = this.nodes.get(node.parentId);
        if (!parent) { return []; }

        const siblings: vscode.Uri[] = [];
        for (const childKey of parent.children) {
            if (childKey !== uri.toString()) {
                const child = this.nodes.get(childKey);
                if (child) {
                    siblings.push(child.uri);
                }
            }
        }
        return siblings;
    }

    public getChildren(uri: vscode.Uri): vscode.Uri[] {
        const node = this.nodes.get(uri.toString());
        if (!node) { return []; }

        const children: vscode.Uri[] = [];
        for (const childKey of node.children) {
            const child = this.nodes.get(childKey);
            if (child) {
                children.push(child.uri);
            }
        }
        return children;
    }

    public getNode(uri: vscode.Uri): HierarchyNode | undefined {
        return this.nodes.get(uri.toString());
    }
}
