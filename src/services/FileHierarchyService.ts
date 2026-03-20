import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

export interface HierarchyNode {
    uri: vscode.Uri;
    parentId?: string; // URI string
    children: Set<string>; // URI strings
    type: 'original' | 'filter' | 'bookmark';
    label: string;
}

export class FileHierarchyService {
    private static instance: FileHierarchyService;

    private _onDidChangeHierarchy: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeHierarchy: vscode.Event<void> = this._onDidChangeHierarchy.event;

    private readonly storageKey = 'logmagnifier.fileHierarchy';
    private nodes: Map<string, HierarchyNode> = new Map();
    private storage: vscode.Memento;

    private constructor(storage: vscode.Memento) {
        this.storage = storage;
        this.restore();
        this.pruneStaleNodes();
    }

    /** Creates and returns the singleton instance, storing hierarchy in workspace state. */
    public static createInstance(context: vscode.ExtensionContext): FileHierarchyService {
        FileHierarchyService.instance = new FileHierarchyService(context.workspaceState);
        return FileHierarchyService.instance;
    }

    /** Returns the singleton instance, throwing if not yet initialized. */
    public static getInstance(): FileHierarchyService {
        if (!FileHierarchyService.instance) {
            throw new Error('FileHierarchyService not initialized. Call createInstance(context) first.');
        }
        return FileHierarchyService.instance;
    }

    /** Registers a child file (filter or bookmark) under a parent, creating the parent node if needed. */
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

        const parentNode = this.nodes.get(parentKey);
        parentNode?.children.add(childKey);

        this.nodes.set(childKey, {
            uri: childUri,
            parentId: parentKey,
            children: new Set(),
            type: type,
            label: label ?? path.basename(childUri.fsPath)
        });

        this.save();
        this._onDidChangeHierarchy.fire();
    }

    /** Removes a node from the hierarchy, optionally removing all its descendants. */
    public unregister(uri: vscode.Uri, recursive: boolean = false) {
        if (recursive) {
            this.removeGroup(uri);
        } else {
            const key = uri.toString();
            const node = this.nodes.get(key);

            if (node) {
                if (node.parentId) {
                    const parent = this.nodes.get(node.parentId);
                    if (parent) {
                        parent.children.delete(key);
                    }
                }
                this.nodes.delete(key);

                this.save();
                this._onDidChangeHierarchy.fire();
            }
        }
    }

    /** Returns the parent URI of the given node, or undefined if it has no parent. */
    public getParent(uri: vscode.Uri): vscode.Uri | undefined {
        const node = this.nodes.get(uri.toString());
        if (node && node.parentId) {
            const parent = this.nodes.get(node.parentId);
            return parent ? parent.uri : vscode.Uri.parse(node.parentId);
        }
        return undefined;
    }

    /** Walks up the hierarchy and returns the root ancestor URI. */
    public getRoot(uri: vscode.Uri): vscode.Uri | undefined {
        let current = this.nodes.get(uri.toString());
        if (!current) { return undefined; }

        while (current.parentId) {
            const parent = this.nodes.get(current.parentId);
            if (!parent) { break; }
            current = parent;
        }

        return current.uri;
    }

    /** Returns sibling URIs that share the same parent, excluding the given URI itself. */
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

    /** Returns the child URIs of the given node. */
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

    /** Returns the hierarchy node for the given URI, or undefined if not registered. */
    public getNode(uri: vscode.Uri): HierarchyNode | undefined {
        return this.nodes.get(uri.toString());
    }

    private save() {
        const entries = Array.from(this.nodes.entries()).map(([key, node]) => {
            return [key, {
                ...node,
                children: Array.from(node.children)
            }];
        });
        Promise.resolve(this.storage.update(this.storageKey, entries)).catch(() => {
            // Storage write failures are non-fatal; hierarchy will be rebuilt on next activation
        });
    }

    private restore() {
        interface StoredNode {
            uri: { scheme: string; authority: string; path: string } | string;
            parentId?: string;
            children?: string[];
            type: 'original' | 'filter' | 'bookmark';
            label?: string;
        }
        const entries = this.storage.get<[string, StoredNode][]>(this.storageKey, []) ?? [];
        this.nodes = new Map();

        for (const [key, rawNode] of entries) {
            if (!rawNode || typeof rawNode !== 'object') { continue; }
            let uri: vscode.Uri;
            if (rawNode.uri && typeof rawNode.uri === 'object' && 'path' in rawNode.uri) {
                uri = vscode.Uri.from(rawNode.uri);
            } else if (typeof rawNode.uri === 'string') {
                uri = vscode.Uri.parse(rawNode.uri);
            } else {
                continue;
            }

            this.nodes.set(key, {
                uri: uri,
                parentId: rawNode.parentId,
                children: new Set(rawNode.children ?? []),
                type: rawNode.type,
                label: rawNode.label ?? ''
            });
        }
    }

    private removeGroup(uri: vscode.Uri) {
        const key = uri.toString();
        const node = this.nodes.get(key);
        if (!node) { return; }

        const children = Array.from(node.children);
        for (const childKey of children) {
            const childNode = this.nodes.get(childKey);
            if (childNode) {
                this.removeGroup(childNode.uri);
            }
        }

        if (node.parentId) {
            const parent = this.nodes.get(node.parentId);
            if (parent) {
                parent.children.delete(key);
            }
        }

        this.nodes.delete(key);

        this.save();
        this._onDidChangeHierarchy.fire();
    }

    /**
     * Removes nodes whose temp files no longer exist on disk.
     * Only prunes files under the OS temp directory to avoid removing
     * legitimate entries for files on removable/network drives.
     */
    private pruneStaleNodes() {
        const tmpDir = os.tmpdir();
        const staleKeys: string[] = [];
        for (const [key, node] of this.nodes) {
            if (node.uri.scheme === 'file' && node.uri.fsPath.startsWith(tmpDir)) {
                try {
                    if (!fs.existsSync(node.uri.fsPath)) {
                        staleKeys.push(key);
                    }
                } catch {
                    staleKeys.push(key);
                }
            }
        }

        if (staleKeys.length === 0) { return; }

        for (const key of staleKeys) {
            const node = this.nodes.get(key);
            if (node) {
                if (node.parentId) {
                    const parent = this.nodes.get(node.parentId);
                    if (parent) {
                        parent.children.delete(key);
                    }
                }
                this.nodes.delete(key);
            }
        }
        this.save();
    }
}
