import * as vscode from 'vscode';
import { Constants } from '../constants';

interface SourceMapping {
    sourceUri: vscode.Uri;
    lineMapping: number[]; // Index: filtered line, Value: original line
}

export class SourceMapService {
    private static instance: SourceMapService;
    private mappings: Map<string, SourceMapping> = new Map();

    private constructor() { }

    public static getInstance(): SourceMapService {
        if (!SourceMapService.instance) {
            SourceMapService.instance = new SourceMapService();
        }
        return SourceMapService.instance;
    }

    /**
     * Registers a mapping between a filtered file and its source.
     * @param filteredUri URI of the generated filtered file
     * @param sourceUri URI of the original source file
     * @param lineMapping Array where index is filtered line number and value is source line number
     */
    public register(filteredUri: vscode.Uri, sourceUri: vscode.Uri, lineMapping: number[]): void {
        this.mappings.set(filteredUri.toString(), {
            sourceUri,
            lineMapping
        });
    }

    /**
     * Retrieves the original location given a position in a filtered file.
     * @param filteredUri URI of the filtered file
     * @param line Line number in the filtered file (0-based)
     */
    public getOriginalLocation(filteredUri: vscode.Uri, line: number): vscode.Location | undefined {
        const mapping = this.mappings.get(filteredUri.toString());
        if (!mapping) {
            return undefined;
        }

        const originalLine = mapping.lineMapping[line];
        if (originalLine === undefined) {
            return undefined;
        }

        // Create a range for the target line (start to end of line)
        // Point to the start of the line (0, 0)
        const position = new vscode.Position(originalLine, 0);
        return new vscode.Location(mapping.sourceUri, position);
    }

    /**
     * Cleans up mappings when a filtered file is closed.
     * @param filteredUri URI of the filtered file
     */
    public unregister(filteredUri: vscode.Uri): void {
        this.mappings.delete(filteredUri.toString());
    }

    /**
     * Checks if a document has a mapping.
     */
    public hasMapping(uri: vscode.Uri): boolean {
        return this.mappings.has(uri.toString());
    }

    /**
     * Updates the context key based on whether the active editor is a filtered log.
     */
    public updateContextKey(editor: vscode.TextEditor | undefined): void {
        const isFiltered = editor ? this.hasMapping(editor.document.uri) : false;
        vscode.commands.executeCommand('setContext', 'logmagnifier.isFilteredLog', isFiltered);
    }

    // Pending Navigation for Animation
    private pendingNavigation: { uri: vscode.Uri, line: number, timestamp: number } | undefined;

    public setPendingNavigation(uri: vscode.Uri, line: number): void {
        // Optimization: Avoid object churn if the target hasn't changed.
        // We update the timestamp to keep the navigation window open without allocating a new object.
        if (this.pendingNavigation &&
            this.pendingNavigation.line === line &&
            this.pendingNavigation.uri.toString() === uri.toString()) {
            this.pendingNavigation.timestamp = Date.now();
            return;
        }

        this.pendingNavigation = {
            uri,
            line,
            timestamp: Date.now()
        };
    }

    public checkAndConsumePendingNavigation(uri: vscode.Uri, line: number): boolean {
        if (!this.pendingNavigation) {
            return false;
        }

        const now = Date.now();
        // Check validity (same file, same line, within 10 seconds)
        // Use fsPath for file URIs to avoid case/encoding mismatches
        const isSameUri = (this.pendingNavigation.uri.scheme === Constants.Schemes.File && uri.scheme === Constants.Schemes.File)
            ? this.pendingNavigation.uri.fsPath === uri.fsPath
            : this.pendingNavigation.uri.toString() === uri.toString();

        if (isSameUri &&
            this.pendingNavigation.line === line &&
            (now - this.pendingNavigation.timestamp) < 10000) {

            this.pendingNavigation = undefined; // Consume
            return true;
        }

        return false;
    }
}
