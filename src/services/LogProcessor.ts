import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import { FilterGroup } from '../models/Filter';

export class LogProcessor {
    /**
     * Processes a log file and returns filtered lines.
     * @param inputPath Path to the input log file.
     * @param filterGroups Active filter groups to apply.
     * @returns A promise that resolves to the output path and statistics.
     */
    public async processFile(inputPath: string, filterGroups: FilterGroup[]): Promise<{ outputPath: string, processed: number, matched: number }> {
        // Enforce utf8 to handle most text logs
        const fileStream = fs.createReadStream(inputPath, { encoding: 'utf8' });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        const activeGroups = filterGroups.filter(g => g.isEnabled);

        // Create a temp file for output
        const os = require('os');
        const path = require('path');
        const tmpDir = os.tmpdir();
        const prefix = vscode.workspace.getConfiguration('loglens').get<string>('tempFilePrefix') || 'filtered_';
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mo = (now.getMonth() + 1).toString().padStart(2, '0');
        const dd = now.getDate().toString().padStart(2, '0');
        const hh = now.getHours().toString().padStart(2, '0');
        const mi = now.getMinutes().toString().padStart(2, '0');
        const ss = now.getSeconds().toString().padStart(2, '0');
        const outputFilename = `${prefix}${yy}${mo}${dd}_${hh}${mi}${ss}.log`;
        const outputPath = path.join(tmpDir, outputFilename);
        const outputStream = fs.createWriteStream(outputPath);

        let processed = 0;
        let matched = 0;

        try {
            for await (const line of rl) {
                processed++;
                if (this.shouldKeepLine(line, activeGroups)) {
                    matched++;
                    // Write to output stream with newline
                    if (!outputStream.write(line + '\n')) {
                        // Handle backpressure
                        await new Promise<void>(resolve => outputStream.once('drain', () => resolve()));
                    }
                }
            }
        } finally {
            outputStream.end();
            // Wait for stream to finish
            await new Promise<void>(resolve => outputStream.on('finish', () => resolve()));
        }

        return { outputPath, processed, matched };
    }

    /**
     * Determines if a line should be kept based on active filter groups.
     * Logic: (Group1) AND (Group2) ...
     * Within Group: (Include A OR Include B ...) AND NOT (Exclude C OR Exclude D ...)
     */
    private shouldKeepLine(line: string, groups: FilterGroup[]): boolean {
        for (const group of groups) {
            const includes = group.filters.filter(f => f.type === 'include' && f.isEnabled);
            const excludes = group.filters.filter(f => f.type === 'exclude' && f.isEnabled);

            // Check Excludes first (Fail fast)
            for (const exclude of excludes) {
                if (exclude.isRegex) {
                    try {
                        const regex = new RegExp(exclude.keyword);
                        if (regex.test(line)) {
                            return false;
                        }
                    } catch (e) { /* ignore invalid regex */ }
                } else {
                    if (line.includes(exclude.keyword)) {
                        return false;
                    }
                }
            }

            // Check Includes
            if (includes.length > 0) {
                let matchFound = false;
                for (const include of includes) {
                    if (include.isRegex) {
                        try {
                            const regex = new RegExp(include.keyword);
                            if (regex.test(line)) {
                                matchFound = true;
                                break;
                            }
                        } catch (e) { /* ignore invalid regex */ }
                    } else {
                        if (line.includes(include.keyword)) {
                            matchFound = true;
                            break;
                        }
                    }
                }
                if (!matchFound) {
                    return false;
                }
            }
        }
        return true;
    }
}
