import * as cp from 'child_process';
import * as crypto from 'crypto';

import * as vscode from 'vscode';

import { Constants } from '../../Constants';
import { AdbDevice, LogcatSession, LogcatTag } from '../../models/AdbModels';

import { Logger } from '../Logger';
import { AdbClient } from './AdbClient';
import { AdbTargetAppService } from './AdbTargetAppService';

export class AdbLogcatService {
    private static readonly MAX_BUFFER_LINES = 10_000;
    private static readonly FLUSH_INTERVAL_MS = 500;

    private _onDidChangeSessions = new vscode.EventEmitter<void>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private sessions: Map<string, LogcatSession> = new Map();
    private processes: Map<string, cp.ChildProcess> = new Map();
    private buffers: Map<string, string[]> = new Map();
    private flushTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        private logger: Logger,
        private client: AdbClient,
        private targetAppService: AdbTargetAppService
    ) { }

    /** Returns all logcat sessions. */
    public getSessions(): LogcatSession[] {
        return Array.from(this.sessions.values());
    }

    /** Returns a logcat session by ID, or undefined if not found. */
    public getSession(id: string): LogcatSession | undefined {
        return this.sessions.get(id);
    }

    /** Creates a new logcat session for the given device. */
    public createSession(name: string, device: AdbDevice): LogcatSession {
        const session: LogcatSession = {
            id: crypto.randomUUID(),
            name,
            device,
            tags: [],
            isRunning: false,
            useStartFromCurrentTime: true
        };
        this.sessions.set(session.id, session);
        this._onDidChangeSessions.fire();
        this.logger.info(`[Session] Created session '${name}' for device ${device.id}`);
        return session;
    }

    /** Stops and removes a logcat session by ID. */
    public removeSession(id: string) {
        this.stopSession(id);
        this.sessions.delete(id);
        this._onDidChangeSessions.fire();
        this.logger.info(`[Session] Removed session ${id}`);
    }

    /** Starts the logcat process for a session, creating an output document if needed. */
    public async startSession(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (!session || session.isRunning) {
            return;
        }

        // Verify document
        if (session.outputDocumentUri) {
            const uri = vscode.Uri.parse(session.outputDocumentUri);
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
            if (!doc || doc.isClosed) {
                session.outputDocumentUri = undefined;
            }
        }

        try {
            const adbPath = this.client.getAdbPath();
            const defaultOptions = vscode.workspace.getConfiguration(Constants.Configuration.Section).get<string>(Constants.Configuration.Adb.DefaultOptions) || Constants.Defaults.AdbDefaultOptions;

            const args = ['-s', session.device.id, 'logcat'];
            const startFromNow = session.useStartFromCurrentTime !== false;

            // Parse default options (allowlist to prevent argument injection)
            const ALLOWED_LOGCAT_FLAGS = new Set(['-v', '-b', '-T', '-t', '-d', '-e', '-s', '--regex', '--pid', '-c']);
            // Space is intentionally excluded: values are passed as array elements to execFile (no shell expansion)
            const SAFE_VALUE_PATTERN = /^[a-zA-Z0-9_.,:/*=\-+@]+$/;
            if (defaultOptions.trim().length > 0) {
                const parts = defaultOptions.split(/\s+/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    const [flag, ...valueParts] = part.split('=');
                    if (!ALLOWED_LOGCAT_FLAGS.has(flag)) {
                        this.logger.warn(`[ADB] Ignoring unrecognised default option: ${part}`);
                        continue;
                    }
                    const inlineValue = valueParts.join('=');
                    if (inlineValue && !SAFE_VALUE_PATTERN.test(inlineValue)) {
                        this.logger.warn(`[ADB] Ignoring option with unsafe value: ${part}`);
                        continue;
                    }
                    if (part === '-T' || part === '-t') {
                        if (!startFromNow) {
                            i++;
                            continue;
                        }
                    }
                    args.push(part);
                }
            }

            const hasTimeArg = args.includes('-T') || args.includes('-t');
            if (startFromNow && !hasTimeArg) {
                args.push('-T', '1');
            }

            // PID Filter
            if (session.device.targetApp && session.device.targetApp !== 'all') {
                const pid = await this.targetAppService.getAppPid(session.device.id, session.device.targetApp);
                if (pid) {
                    this.logger.info(`[ADB] Resolved PID for ${session.device.targetApp}: ${pid}`);
                    args.push(`--pid=${pid}`);
                } else {
                    vscode.window.showWarningMessage(Constants.Messages.Warn.AppNotRunning.replace('{0}', session.device.targetApp));
                }
            }

            // Tag filters
            if (session.tags.length > 0) {
                const TAG_NAME_PATTERN = /^[a-zA-Z0-9._\-/]+$/;
                session.tags.forEach(tag => {
                    if (tag.isEnabled) {
                        if (!TAG_NAME_PATTERN.test(tag.name)) {
                            this.logger.warn(`[ADB] Skipping invalid tag name: ${tag.name}`);
                            return;
                        }
                        args.push(`${tag.name}:${tag.priority}`);
                    }
                });
                args.push('*:S');
            } else {
                args.push('*:V');
            }

            this.logger.info(`[ADB] Starting logcat: ${adbPath} ${args.join(' ')}`);
            const child = this.client.spawnAdb(args);
            this.processes.set(sessionId, child);
            session.isRunning = true;
            this._onDidChangeSessions.fire();

            if (!session.outputDocumentUri) {
                await this.createLogDocument(session, args.join(' '));
            }

            child.stdout?.on('data', data => this.bufferLogs(sessionId, data.toString().split('\n')));
            child.stderr?.on('data', data => this.bufferLogs(sessionId, data.toString().split('\n').map((l: string) => `[STDERR] ${l}`)));

            child.on('close', (code) => {
                this.logger.info(`[ADB] Logcat process exited: ${code}`);
                session.isRunning = false;
                this.processes.delete(sessionId);
                this._onDidChangeSessions.fire();
                this.flushLogs(sessionId).catch(e => this.logger.error(`[AdbLogcatService] Final flush failed: ${e instanceof Error ? e.message : String(e)}`));
            });

            child.on('error', (err) => {
                this.logger.error(`[ADB] Logcat error: ${err.message}`);
                vscode.window.showErrorMessage(Constants.Messages.Error.LogcatStartFailed.replace('{0}', err.message));
                session.isRunning = false;
                this._onDidChangeSessions.fire();
            });

        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[ADB] Exception starting logcat: ${msg}`);
            vscode.window.showErrorMessage(Constants.Messages.Error.LogcatStartFailed.replace('{0}', msg));
        }
    }

    private async createLogDocument(session: LogcatSession, command: string) {
        const now = new Date();
        const header = `Logcat session: ${session.name}\nCommand: adb ${command}\nDate: ${now.toISOString()}\n${'='.repeat(80)}\n`;
        const doc = await vscode.workspace.openTextDocument({ language: 'log', content: header });
        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        session.outputDocumentUri = doc.uri.toString();
    }

    /** Stops the logcat process for a session and clears its flush timer. */
    public stopSession(sessionId: string) {
        const child = this.processes.get(sessionId);
        if (child) {
            child.kill();
            this.processes.delete(sessionId);
        }
        const session = this.sessions.get(sessionId);
        if (session) {
            session.isRunning = false;
            this._onDidChangeSessions.fire();
        }
        const timer = this.flushTimers.get(sessionId);
        if (timer) {
            clearInterval(timer);
            this.flushTimers.delete(sessionId);
        }
    }

    /** Adds a tag filter to a stopped session. */
    public addTag(sessionId: string, tag: LogcatTag) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            session.tags.push(tag);
            this._onDidChangeSessions.fire();
        }
    }

    /** Removes a tag filter from a stopped session. */
    public removeTag(sessionId: string, tagId: string) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            session.tags = session.tags.filter(t => t.id !== tagId);
            this._onDidChangeSessions.fire();
        }
    }

    /** Replaces an existing tag filter on a stopped session. */
    public updateTag(sessionId: string, tag: LogcatTag) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            const index = session.tags.findIndex(t => t.id === tag.id);
            if (index !== -1) {
                session.tags[index] = tag;
                this._onDidChangeSessions.fire();
            }
        }
    }

    /** Toggles whether a stopped session starts from the current time or from the beginning. */
    public toggleSessionTimeFilter(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isRunning) {
            session.useStartFromCurrentTime = !session.useStartFromCurrentTime;
            this._onDidChangeSessions.fire();
        }
    }

    private bufferLogs(sessionId: string, lines: string[]) {
        const buffer = this.buffers.get(sessionId) || [];
        buffer.push(...lines.filter(l => l.length > 0));
        // Evict oldest lines if buffer grows beyond cap (e.g. repeated flush failures)
        if (buffer.length > AdbLogcatService.MAX_BUFFER_LINES) {
            buffer.splice(0, buffer.length - AdbLogcatService.MAX_BUFFER_LINES);
        }
        this.buffers.set(sessionId, buffer);

        if (!this.flushTimers.has(sessionId)) {
            const timer = setInterval(() => {
                this.flushLogs(sessionId).catch(e =>
                    this.logger.error(`[AdbLogcatService] Flush failed: ${e instanceof Error ? e.message : String(e)}`)
                );
            }, AdbLogcatService.FLUSH_INTERVAL_MS);
            this.flushTimers.set(sessionId, timer);
        }
    }

    private flushing = new Set<string>();

    private async flushLogs(sessionId: string) {
        if (this.flushing.has(sessionId)) {
            return;
        }
        this.flushing.add(sessionId);
        try {
            await this.flushLogsInternal(sessionId);
        } finally {
            this.flushing.delete(sessionId);
        }
    }

    private async flushLogsInternal(sessionId: string) {
        const buffer = this.buffers.get(sessionId);
        if (!buffer || buffer.length === 0) {
            return;
        }

        const session = this.sessions.get(sessionId);
        if (!session || !session.outputDocumentUri) {
            this.buffers.set(sessionId, []);
            return;
        }

        const content = buffer.join('\n') + '\n';
        this.buffers.set(sessionId, []);

        try {
            const uri = vscode.Uri.parse(session.outputDocumentUri);
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());

            if (doc) {
                const edit = new vscode.WorkspaceEdit();
                const pos = new vscode.Position(doc.lineCount, 0);
                edit.insert(uri, pos, content);
                if (await vscode.workspace.applyEdit(edit)) {
                    // Auto-scroll
                    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
                    if (editor) {
                        const newPos = new vscode.Position(doc.lineCount - 1, 0);
                        editor.revealRange(new vscode.Range(newPos, newPos));
                    }
                }
            } else {
                this.stopSession(sessionId);
            }
        } catch (e: unknown) {
            this.logger.error(`[AdbLogcatService] Flush logs failed: ${e instanceof Error ? e.message : String(e)}`);
            vscode.window.showWarningMessage('Log flush failed for session — some log data may be lost.');
        }
    }

    public dispose() {
        this.flushTimers.forEach(clearInterval);
        this.processes.forEach(p => p.kill());
        this._onDidChangeSessions.dispose();
    }
}
