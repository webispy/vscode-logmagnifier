import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { Logger } from './Logger';

export interface HierarchyNode {
    uri: vscode.Uri;
    parentId?: string; // URI string
    children: Set<string>; // URI strings
    type: 'original' | 'filter' | 'bookmark';
    label: string;
}

export class FileHierarchyService implements vscode.Disposable {
    // Case-insensitive filesystems (macOS default, Windows) can produce
    // differently-cased paths for the same file. Normalize the key on those
    // platforms so hierarchy lookups don't create duplicate entries.
    private static readonly caseInsensitiveFs = process.platform === 'darwin' || process.platform === 'win32';
    private static instance: FileHierarchyService;

    private _onDidChangeHierarchy: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeHierarchy: vscode.Event<void> = this._onDidChangeHierarchy.event;

    private readonly storageKey = 'logmagnifier.fileHierarchy';
    private nodes: Map<string, HierarchyNode> = new Map();
    private storage: vscode.Memento;
    private logger: Logger;

    /** Returns a storage key that is stable across filesystem case variations (file:// only). */
    public static keyOf(uri: vscode.Uri): string {
        if (FileHierarchyService.caseInsensitiveFs && uri.scheme === 'file') {
            return uri.with({ path: uri.path.toLowerCase() }).toString();
        }
        return uri.toString();
    }

    private constructor(storage: vscode.Memento, logger: Logger) {
        this.storage = storage;
        this.logger = logger;
        this.restore();
        this.pruneStaleNodes().catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn(`[FileHierarchyService] Failed to prune stale nodes: ${msg}`);
        });
    }

    /** Creates and returns the singleton instance, storing hierarchy in workspace state. */
    public static createInstance(context: vscode.ExtensionContext, logger: Logger): FileHierarchyService {
        if (FileHierarchyService.instance) {
            return FileHierarchyService.instance;
        }
        FileHierarchyService.instance = new FileHierarchyService(context.workspaceState, logger);
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
        const parentKey = FileHierarchyService.keyOf(parentUri);
        const childKey = FileHierarchyService.keyOf(childUri);

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
            const key = FileHierarchyService.keyOf(uri);
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
        const node = this.nodes.get(FileHierarchyService.keyOf(uri));
        if (node && node.parentId) {
            const parent = this.nodes.get(node.parentId);
            return parent ? parent.uri : vscode.Uri.parse(node.parentId);
        }
        return undefined;
    }

    /** Walks up the hierarchy and returns the root ancestor URI. */
    public getRoot(uri: vscode.Uri): vscode.Uri | undefined {
        let current = this.nodes.get(FileHierarchyService.keyOf(uri));
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
        const selfKey = FileHierarchyService.keyOf(uri);
        const node = this.nodes.get(selfKey);
        if (!node || !node.parentId) { return []; }

        const parent = this.nodes.get(node.parentId);
        if (!parent) { return []; }

        const siblings: vscode.Uri[] = [];
        for (const childKey of parent.children) {
            if (childKey !== selfKey) {
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
        const node = this.nodes.get(FileHierarchyService.keyOf(uri));
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
        return this.nodes.get(FileHierarchyService.keyOf(uri));
    }

    private save() {
        const entries = Array.from(this.nodes.entries()).map(([key, node]) => {
            return [key, {
                ...node,
                children: Array.from(node.children)
            }];
        });
        Promise.resolve(this.storage.update(this.storageKey, entries)).catch((e: unknown) => {
            void e; // Storage write failures are non-fatal; hierarchy will be rebuilt on next activation
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

        for (const [, rawNode] of entries) {
            if (!rawNode || typeof rawNode !== 'object') { continue; }
            let uri: vscode.Uri;
            if (rawNode.uri && typeof rawNode.uri === 'object' && 'path' in rawNode.uri) {
                uri = vscode.Uri.from(rawNode.uri);
            } else if (typeof rawNode.uri === 'string') {
                uri = vscode.Uri.parse(rawNode.uri);
            } else {
                continue;
            }

            // Normalize legacy (pre-m6) unnormalized keys on load.
            const normalizedKey = FileHierarchyService.keyOf(uri);
            const normalizedParentId = rawNode.parentId
                ? FileHierarchyService.keyOf(vscode.Uri.parse(rawNode.parentId))
                : undefined;
            const normalizedChildren = (rawNode.children ?? []).map(c =>
                FileHierarchyService.keyOf(vscode.Uri.parse(c)));

            this.nodes.set(normalizedKey, {
                uri: uri,
                parentId: normalizedParentId,
                children: new Set(normalizedChildren),
                type: rawNode.type,
                label: rawNode.label ?? ''
            });
        }
    }

    private removeGroup(uri: vscode.Uri) {
        const key = FileHierarchyService.keyOf(uri);
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

    public dispose(): void {
        this._onDidChangeHierarchy.dispose();
    }

    /**
     * Removes nodes whose temp files no longer exist on disk.
     * Only prunes files under the OS temp directory to avoid removing
     * legitimate entries for files on removable/network drives.
     */
    private async pruneStaleNodes() {
        const tmpDir = os.tmpdir();
        const staleKeys: string[] = [];
        for (const [key, node] of this.nodes) {
            if (node.uri.scheme === 'file' && node.uri.fsPath.startsWith(tmpDir)) {
                try {
                    await fsp.access(node.uri.fsPath);
                } catch (_e: unknown) {
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
