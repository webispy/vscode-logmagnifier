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
        try {
            const [
                props,
                wmSize,
                wmDensity,
                windowDisplays,
                battery,
                memInfo
            ] = await Promise.all([
                this.getDeviceProps(deviceId),
                this.getWmSize(deviceId),
                this.getWmDensity(deviceId),
                this.getWindowDisplays(deviceId),
                this.getBatteryInfo(deviceId),
                this.getMemInfo(deviceId)
            ]);

            // IP Address & Public IP
            let ipAddressString = 'Unknown';
            let publicIpString = '';

            try {
                const ipData = await this.getIpInfo(deviceId);
                if (ipData.internal.length > 0) {
                    // IP Address: 172.20.10.7 (wlan0)
                    //             192.0.0.2 (rmnet_data1)
                    ipAddressString = ipData.internal[0];
                    if (ipData.internal.length > 1) {
                        const padding = ' '.repeat(14); // "  IP Address: " length
                        for (let i = 1; i < ipData.internal.length; i++) {
                            ipAddressString += `\n${padding}${ipData.internal[i]}`;
                        }
                    }
                }
                if (ipData.public) {
                    publicIpString = `\n  Public IP: ${ipData.public}`;
                }
            } catch (error) {
                this.logger.warn(`Failed to process IP info: ${error}`);
            }

            // Parsing Device Info
            const model = this.getPropValue(props, 'ro.product.model');
            const androidVersion = this.getPropValue(props, 'ro.build.version.release');
            const sdkVersion = this.getPropValue(props, 'ro.build.version.sdk');
            const cpuAbi = this.getPropValue(props, 'ro.product.cpu.abi');
            const androidId = (await this.client.execAdb(['-s', deviceId, 'shell', 'settings', 'get', 'secure', 'android_id'])).trim();

            // Parsing Display Info
            // wm size: Physical size: 1080x2340
            const sizeMatch = wmSize.match(/Physical size: (\d+x\d+)/);
            const resolution = sizeMatch ? sizeMatch[1] : 'Unknown';
            // wm density: Physical density: 480
            const densityMatch = wmDensity.match(/Physical density: (\d+)/);
            const density = densityMatch ? parseInt(densityMatch[1], 10) : 0;

            // Calculate DP
            let dpResolution = '';
            let dpWidth = 0, dpHeight = 0;
            if (resolution !== 'Unknown' && density > 0) {
                const [w, h] = resolution.split('x').map(Number);
                const scale = density / 160;
                dpWidth = Math.round(w / scale);
                dpHeight = Math.round(h / scale);
                dpResolution = ` (${dpWidth}x${dpHeight} dp)`;
            }

            // Parse Bounds
            const bounds = this.parseWindowBounds(windowDisplays, 'mBounds', density);
            const appBounds = this.parseWindowBounds(windowDisplays, 'mAppBounds', density);
            const maxBounds = this.parseWindowBounds(windowDisplays, 'mMaxBounds', density);

            // Parsing Environment
            const locale = this.getPropValue(props, 'ro.product.locale') || this.getPropValue(props, 'persist.sys.locale');
            const timezone = this.getPropValue(props, 'persist.sys.timezone');

            const batteryMatch = battery.match(/level: (\d+)/);
            const batteryLevel = batteryMatch ? `${batteryMatch[1]}%` : 'Unknown';

            // Parsing Memory
            const memTotalMatch = memInfo.match(/MemTotal:\s+(\d+)\s+kB/);
            const memAvailMatch = memInfo.match(/MemAvailable:\s+(\d+)\s+kB/);
            const memTotal = memTotalMatch ? Math.round(parseInt(memTotalMatch[1], 10) / 1024) : 0;
            const memAvail = memAvailMatch ? Math.round(parseInt(memAvailMatch[1], 10) / 1024) : 0;

            // Parsing Storage
            let storageTotal = 'Unknown';
            let storageFree = 'Unknown';

            try {
                const diskUsage = await this.getDiskUsage(deviceId);
                storageTotal = diskUsage.total;
                storageFree = diskUsage.free;
            } catch (error) {
                this.logger.warn(`Failed to get disk usage: ${error}`);
            }

            return `System Info for ${model}
========================================
[Device]
  Model: ${model}
  Android Version: ${androidVersion} (SDK ${sdkVersion})
  CPU ABI: ${cpuAbi}
  Android ID: ${androidId}

[Display]
  Resolution: ${resolution}, ${density}${dpResolution}
  mBounds:    ${bounds}
  mAppBounds: ${appBounds}
  mMaxBounds: ${maxBounds}

[Environment]
  Locale: ${locale}
  Timezone: ${timezone}
  Battery: ${batteryLevel}
  IP Address: ${ipAddressString}${publicIpString}

[Memory & Storage]
  RAM: Total ${memTotal} MB / Available ${memAvail} MB
  Internal Storage (/data): Total ${storageTotal} / Free ${storageFree}`;

        } catch (error) {
            this.logger.error(`Error fetching system info: ${error}`);
            // Do not re-throw, simpler message
            return `Error fetching system info: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    public async getSystemProperties(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'getprop']);
    }

    private async getDeviceProps(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'getprop']);
    }

    private async getWmSize(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'wm', 'size']);
    }

    private async getWmDensity(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'wm', 'density']);
    }

    private async getWindowDisplays(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'window', 'displays']);
    }

    private async getBatteryInfo(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'dumpsys', 'battery']);
    }

    private async getIpInfo(deviceId: string): Promise<{ internal: string[], public?: string }> {
        const ips: string[] = [];
        let publicIp: string | undefined;

        // 1. Internal IPs via ip route
        try {
            const output = await this.client.execAdb(['-s', deviceId, 'shell', 'ip', 'route']);
            const lines = output.trim().split('\n');

            for (const line of lines) {
                // 172.20.10.0/28 dev wlan0 proto kernel scope link src 172.20.10.7
                const srcMatch = line.match(/src\s+([\d.]+)/);
                const devMatch = line.match(/dev\s+([^\s]+)/);
                if (srcMatch && devMatch) {
                    const ip = srcMatch[1];
                    const dev = devMatch[1];
                    if (ip !== '127.0.0.1') { // Excluding localhost if it appears in route (unlikely but safe)
                        ips.push(`${ip} (${dev})`);
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`[ADB] Failed to get internal IP info: ${error}`);
        }

        // 2. Public IP via curl
        try {
            // Use a short timeout to avoid hanging if no internet
            const output = await this.client.execAdb(['-s', deviceId, 'shell', 'curl', '-s', '--connect-timeout', '5', 'https://api.ipify.org']);
            if (output && output.trim().match(/^[\d.]+$/)) {
                publicIp = `${output.trim()} (via https://api.ipify.org)`;
            }
        } catch (error) {
            this.logger.warn(`[ADB] Failed to get public IP: ${error}`);
        }

        return { internal: ips, public: publicIp };
    }

    private async getMemInfo(deviceId: string): Promise<string> {
        return this.client.execAdb(['-s', deviceId, 'shell', 'cat', '/proc/meminfo']);
    }

    private async getDiskUsage(deviceId: string): Promise<{ total: string, free: string }> {
        const result = { total: 'Unknown', free: 'Unknown' };
        try {
            const dfDataRaw = await this.client.execAdb(['-s', deviceId, 'shell', 'df', '/data']);
            const dfLines = dfDataRaw.trim().split('\n');
            // Find line ending in /data or /data/user/0
            const dataLine = dfLines.find(l => {
                const p = l.trim().split(/\s+/);
                return p.length > 0 && (p[p.length - 1] === '/data' || p[p.length - 1].startsWith('/data/'));
            });

            if (dataLine) {
                const parts = dataLine.trim().split(/\s+/);
                // Standard df output on Android:
                // Filesystem               1K-blocks   Used Available Use% Mounted on
                // /dev/block/dm-4          117035656 123456  12345678  1% /data
                // Sometimes header is different, but columns are usually: FS, Total, Used, Free, ...
                if (parts.length >= 4) {
                    let totalIndex = -1;
                    let freeIndex = -1;

                    // Try to guess indices based on header if present
                    if (dfLines[0] && dfLines[0].toLowerCase().includes('1k-blocks')) {
                        totalIndex = 1;
                        freeIndex = 3;
                    } else if (dfLines[0] && dfLines[0].toLowerCase().includes('blocks')) {
                        totalIndex = 1;
                        freeIndex = 3;
                    }

                    // Fallback to standard indices if header is missing or complex
                    if (totalIndex === -1 && parts.length >= 5) {
                        totalIndex = 1;
                        freeIndex = 3;
                    }

                    if (totalIndex !== -1 && parts.length > freeIndex) {
                        const totalBlocks = parseInt(parts[totalIndex], 10);
                        const freeBlocks = parseInt(parts[freeIndex], 10);
                        if (!isNaN(totalBlocks) && !isNaN(freeBlocks)) {
                            result.total = this.formatBytes(totalBlocks * 1024);
                            result.free = this.formatBytes(freeBlocks * 1024);
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to parse disk usage: ${error}`);
        }
        return result;
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
    private getPropValue(props: string, key: string): string {
        // Escape special regex characters to prevent CodeQL security issue
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^\\[${escapedKey}\\]: \\[(.*)\\]`, 'm');
        const match = props.match(regex);
        return match ? match[1] : 'Unknown';
    }

    private parseWindowBounds(output: string, key: string, density: number): string {
        // Common formats:
        // mBounds=[0,0][1080,2340]
        // mBounds=Rect(0, 0 - 1080, 2340)

        let l = 0, t = 0, r = 0, b = 0;
        let found = false;

        const regexSquare = new RegExp(`${key}=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]`);
        const regexRect = new RegExp(`${key}=Rect\\((\\d+),\\s*(\\d+)\\s*-\\s*(\\d+),\\s*(\\d+)\\)`);

        let match = output.match(regexSquare);
        if (match) {
            [, l, t, r, b] = match.map(Number);
            found = true;
        } else {
            match = output.match(regexRect);
            if (match) {
                [, l, t, r, b] = match.map(Number);
                found = true;
            }
        }

        if (!found) { return 'Unknown'; }

        // Format: 0, 0 - 1080, 2340 (0,0 - 360,780 dp)
        const densityScale = density > 0 ? density / 160 : 1;
        const dpL = Math.round(l / densityScale);
        const dpT = Math.round(t / densityScale);
        const dpR = Math.round(r / densityScale);
        const dpB = Math.round(b / densityScale);

        return `${l}, ${t} - ${r}, ${b} (${dpL},${dpT} - ${dpR},${dpB} dp)`;
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) { return '0 B'; }
        const k = 1024;
        const sizes = ['B', 'K', 'M', 'G', 'T'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(0)) + sizes[i];
    }
}
