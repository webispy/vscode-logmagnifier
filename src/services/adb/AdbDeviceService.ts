import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { AdbDevice } from '../../models/AdbModels';
import { Logger } from '../Logger';
import { Constants } from '../../Constants';
import { AdbClient } from './AdbClient';

export class AdbDeviceService {
    private recordingProcesses: Map<string, { process: cp.ChildProcess, remotePath: string, pid?: string }> = new Map();
    private stoppingDevices: Set<string> = new Set();
    private _onDidChangeRecordingStatus = new vscode.EventEmitter<void>();
    public readonly onDidChangeRecordingStatus = this._onDidChangeRecordingStatus.event;

    constructor(private logger: Logger, private client: AdbClient) { }

    public async getDevices(): Promise<AdbDevice[]> {
        const adbPath = this.client.getAdbPath(); // Still need path for logging consistency? Or use client wrapper fully?
        // Using client wrapper for execution
        this.logger.info(`[ADB] Executing: ${adbPath} devices -l`);

        try {
            const stdout = await this.client.execAdb(['devices', '-l']);
            this.logger.info(`[ADB] Raw output:\n${stdout.trim()}`);

            const devices: AdbDevice[] = [];
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (!line.trim() || line.startsWith('List of devices attached')) {
                    continue;
                }
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    const id = parts[0];
                    const type = parts[1];
                    const device: AdbDevice = { id, type };

                    for (let i = 2; i < parts.length; i++) {
                        const [key, value] = parts[i].split(':');
                        if (key && value) {
                            if (key === 'transport_id') {
                                device.transportId = value;
                            } else if (key === 'product') {
                                device.product = value;
                            } else if (key === 'model') {
                                device.model = value;
                            } else if (key === 'device') {
                                device.device = value;
                            }
                        }
                    }
                    this.logger.info(`[ADB] Parsed device: ${JSON.stringify(device)}`);
                    devices.push(device);
                }
            }
            return devices;
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.logger.error(`[ADB] Error running adb devices: ${errorMessage}`);
            return [];
        }
    }

    public async captureScreenshot(deviceId: string, localOutputPath: string): Promise<boolean> {
        const remotePath = `/data/local/tmp/vscode_screenshot_${Date.now()}.png`;
        this.logger.info(`[ADB] Capturing screenshot on ${deviceId} to ${remotePath}`);

        try {
            await this.client.execAdb(['-s', deviceId, 'shell', 'screencap', '-p', remotePath]);

            this.logger.info(`[ADB] Pulling screenshot to ${localOutputPath}`);
            await this.client.execAdb(['-s', deviceId, 'pull', remotePath, localOutputPath]);

            // Cleanup
            this.client.execAdb(['-s', deviceId, 'shell', 'rm', remotePath]).catch(() => {
                // Ignore cleanup error
            });
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`[ADB] Screenshot failed: ${msg}`);
            if (!deviceId) { return false; }
            if (!this.client) { return false; }
            this.client.execAdb(['-s', deviceId, 'shell', 'rm', remotePath]).catch(() => {
                // Ignore cleanup error
            });
            return false;
        }
    }

    // Recording Logic
    public isDeviceRecording(deviceId: string): boolean {
        return this.recordingProcesses.has(deviceId);
    }

    public isDeviceStopping(deviceId: string): boolean {
        return this.stoppingDevices.has(deviceId);
    }

    public async startRecording(deviceId: string): Promise<boolean> {
        if (this.isDeviceRecording(deviceId) || this.isDeviceStopping(deviceId)) {
            return false;
        }

        const timestamp = new Date().getTime();
        const remotePath = `/data/local/tmp/screenrecord_${timestamp}.mp4`;
        this.logger.info(`[ADB] Starting recording on ${deviceId} to ${remotePath}`);

        // Spawn manually to handle pipes similar to original implementation
        const adbPath = this.client.getAdbPath();
        const args = ['-s', deviceId, 'shell', 'screenrecord', remotePath];
        const child = cp.spawn(adbPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        if (child.stdout) { child.stdout.on('data', d => this.logger.info(`[ADB][screenrecord] stdout: ${d}`)); }
        if (child.stderr) { child.stderr.on('data', d => this.logger.error(`[ADB][screenrecord] stderr: ${d}`)); }

        child.on('error', (err) => {
            this.logger.error(`[ADB] Failed to start screenrecord: ${err.message}`);
            this.recordingProcesses.delete(deviceId);
            this._onDidChangeRecordingStatus.fire();
            vscode.window.showErrorMessage(Constants.Messages.Error.RecordingFailed.replace('{0}', err.message));
        });

        child.on('close', async (code) => {
            this.logger.info(`[ADB] Local adb process closed on ${deviceId} (code ${code})`);
            this.recordingProcesses.delete(deviceId);
            this._onDidChangeRecordingStatus.fire();

            await this.checkAndPullRecording(deviceId, remotePath);

            if (this.stoppingDevices.has(deviceId)) {
                this.stoppingDevices.delete(deviceId);
                this._onDidChangeRecordingStatus.fire();
            }
        });

        this.recordingProcesses.set(deviceId, { process: child, remotePath });
        this._onDidChangeRecordingStatus.fire();

        // Find PID async
        this.findPid(deviceId, 'screenrecord').then(pid => {
            const info = this.recordingProcesses.get(deviceId);
            if (info && pid) {
                info.pid = pid;
            }
        });

        return true;
    }

    public async stopRecording(deviceId: string): Promise<void> {
        const info = this.recordingProcesses.get(deviceId);
        if (!info) {
            return;
        }

        this.stoppingDevices.add(deviceId);
        this._onDidChangeRecordingStatus.fire();

        // 1. Send SIGINT to remote
        const pid = info.pid || await this.findPid(deviceId, 'screenrecord');
        if (pid) {
            this.client.execAdb(['-s', deviceId, 'shell', 'kill', '-2', pid]).catch(e => this.logger.warn(`Failed to kill -2: ${e}`));
        } else {
            this.logger.warn(`[ADB] Could not determine remote PID. Stopping local process only.`);
        }

        // 2. Wait
        const maxWait = 5000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            const currentPid = await this.findPid(deviceId, 'screenrecord');
            if (!currentPid) {
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }

        // 3. Kill local
        if (info.process) {
            info.process.kill();
        }
    }

    private async checkAndPullRecording(deviceId: string, remotePath: string) {
        let attempts = 0;
        const maxAttempts = 10;
        let previousSize = 0;

        while (attempts < maxAttempts) {
            attempts++;
            let size = 0;
            try {
                const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'ls', '-l', remotePath]);
                const parts = stdout.trim().split(/\s+/);
                if (parts.length >= 5) { size = parseInt(parts[4], 10); }
            } catch { /* ignore */ }

            this.logger.info(`[ADB] File size check (${attempts}/${maxAttempts}): ${size} bytes`);

            if (size > 0 && size === previousSize) {
                await this.pullRecording(deviceId, remotePath);
                return;
            } else if (size > 0 && attempts >= maxAttempts) {
                await this.pullRecording(deviceId, remotePath);
                return;
            } else if (size === 0 && attempts >= maxAttempts) {
                vscode.window.showErrorMessage(Constants.Messages.Error.RecordingEmpty);
                return;
            }
            previousSize = size;
            await new Promise(r => setTimeout(r, 500));
        }
    }

    private async pullRecording(deviceId: string, remotePath: string) {
        const tmpDir = os.tmpdir();
        const now = new Date();
        const filename = `screenrecord_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.mp4`;
        const localPath = path.join(tmpDir, filename);

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Pulling screen recording...",
            cancellable: false
        }, async () => {
            try {
                await this.client.execAdb(['-s', deviceId, 'pull', remotePath, localPath]);
                const uri = vscode.Uri.file(localPath);
                await vscode.commands.executeCommand('vscode.open', uri);
            } catch (_e: unknown) {
                vscode.window.showErrorMessage(Constants.Messages.Error.RetrieveRecordingFailed);
            }
            // Cleanup
            this.client.execAdb(['-s', deviceId, 'shell', 'rm', remotePath]).catch(() => { });
        });
    }

    private async findPid(deviceId: string, search: string): Promise<string | undefined> {
        // Helper local to this service for now, or could make public if needed
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'pidof', '-s', search]);
            if (stdout.trim()) {
                return stdout.trim();
            }
        } catch (_e: unknown) {
            // Ignore error
        }

        // Fallback ps -A
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'ps', '-A']);
            const pid = this.parsePsForPid(stdout, search);
            if (pid) {
                return pid;
            }
        } catch (_e: unknown) {
            // Ignore error
        }

        // Fallback ps
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'ps']);
            return this.parsePsForPid(stdout, search);
        } catch (_e: unknown) {
            // Ignore error
        }

        return undefined;
    }

    private parsePsForPid(output: string, search: string): string | undefined {
        const lines = output.split('\n');
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) {
                continue;
            }
            const pid = parts[1];
            const name = parts.slice(8).join(' ');
            if (name === search || name.endsWith(`/${search}`)) {
                return pid;
            }
        }
        return undefined;
    }

    public async getShowTouchesState(deviceId: string): Promise<boolean> {
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'shell', 'settings', 'get', 'system', 'show_touches']);
            return stdout.trim() === '1';
        } catch (_e: unknown) { return false; }
    }

    public async setShowTouchesState(deviceId: string, enable: boolean): Promise<void> {
        const value = enable ? '1' : '0';
        try {
            await this.client.execAdb(['-s', deviceId, 'shell', 'settings', 'put', 'system', 'show_touches', value]);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`Failed to set show touches: ${msg}`);
        }
    }

    public async toggleShowTouches(deviceId: string): Promise<void> {
        const current = await this.getShowTouchesState(deviceId);
        await this.setShowTouchesState(deviceId, !current);
    }

    public async getSystemInfo(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'echo "Model:" && getprop ro.product.model && echo "Android Version:" && getprop ro.build.version.release && echo "Build ID:" && getprop ro.build.display.id && echo "\n--- MEMINFO ---" && cat /proc/meminfo']);
    }

    public async getSystemProperties(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'getprop']);
    }

    public async installApk(deviceId: string, filePath: string): Promise<boolean> {
        try {
            const stdout = await this.client.execAdb(['-s', deviceId, 'install', '-r', filePath]);
            return stdout.includes('Success');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`Install failed: ${msg}`);
            return false;
        }
    }

    public async runDumpsysAudioPolicy(deviceId: string): Promise<string> {
        try {
            return await this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'media.audio_policy']);
        } catch {
            return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'audio']);
        }
    }

    public async runDumpsysMediaSession(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'media_session']);
    }

    public async runDumpsysAudioFlinger(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'media.audio_flinger']);
    }
}
