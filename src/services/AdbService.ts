import * as vscode from 'vscode';
import { AdbDevice, LogcatSession, LogcatTag } from '../models/AdbModels';
import { Logger } from './Logger';
import { AdbClient } from './adb/AdbClient';
import { AdbDeviceService } from './adb/AdbDeviceService';
import { AdbTargetAppService } from './adb/AdbTargetAppService';
import { AdbLogcatService } from './adb/AdbLogcatService';

export class AdbService implements vscode.Disposable {
    private client: AdbClient;
    private deviceService: AdbDeviceService;
    private targetAppService: AdbTargetAppService;
    private logcatService: AdbLogcatService;

    // Events need to be aggregated or exposed from sub-services
    private _onDidChangeSessions = new vscode.EventEmitter<void>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    constructor(private logger: Logger) {
        this.client = new AdbClient(logger);
        this.deviceService = new AdbDeviceService(logger, this.client);
        this.targetAppService = new AdbTargetAppService(logger, this.client);
        this.logcatService = new AdbLogcatService(logger, this.client, this.targetAppService);

        // Forward events
        this.logcatService.onDidChangeSessions(() => this._onDidChangeSessions.fire());
        this.targetAppService.onDidChangeTargetApp(() => this._onDidChangeSessions.fire());
        this.deviceService.onDidChangeRecordingStatus(() => this._onDidChangeSessions.fire()); // In case recording affects device status display
    }

    // Devices
    public async getDevices(): Promise<AdbDevice[]> {
        const devices = await this.deviceService.getDevices();

        // Sync target apps
        for (const device of devices) {
            const target = this.targetAppService.getTargetApp(device.id);
            if (target && target !== 'all') {
                const running = await this.targetAppService.getRunningApps(device.id);
                if (running.has(target)) {
                    device.targetApp = target;
                } else {
                    this.logger.info(`[ADB] Target app ${target} not running on ${device.id}. Resetting.`);
                    this.targetAppService.setTargetApp(device, 'all');
                    device.targetApp = 'all';
                }
            } else {
                device.targetApp = 'all';
            }
        }
        return devices;
    }

    // Target Apps
    public async getInstalledPackages(deviceId: string): Promise<string[]> {
        return this.targetAppService.getInstalledPackages(deviceId);
    }

    public async getThirdPartyPackages(deviceId: string): Promise<Set<string>> {
        return this.targetAppService.getThirdPartyPackages(deviceId);
    }

    public async getRunningApps(deviceId: string): Promise<Set<string>> {
        return this.targetAppService.getRunningApps(deviceId);
    }

    public async getAppPid(deviceId: string, packageName: string): Promise<string | undefined> {
        return this.targetAppService.getAppPid(deviceId, packageName);
    }

    public setTargetApp(device: AdbDevice, packageName: string) {
        this.targetAppService.setTargetApp(device, packageName);
    }

    public async uninstallApp(deviceId: string, packageName: string): Promise<boolean> {
        return this.targetAppService.uninstallApp(deviceId, packageName);
    }

    public async clearAppStorage(deviceId: string, packageName: string): Promise<boolean> {
        return this.targetAppService.clearAppStorage(deviceId, packageName);
    }

    public async clearAppCache(deviceId: string, packageName: string): Promise<boolean> {
        return this.targetAppService.clearAppCache(deviceId, packageName);
    }

    public async runDumpsysPackage(deviceId: string, packageName: string): Promise<string> {
        return this.targetAppService.runDumpsysPackage(deviceId, packageName);
    }

    public async runDumpsysMeminfo(deviceId: string, packageName: string): Promise<string> {
        return this.targetAppService.runDumpsysMeminfo(deviceId, packageName);
    }

    public async runDumpsysActivity(deviceId: string, packageName: string): Promise<string> {
        return this.targetAppService.runDumpsysActivity(deviceId, packageName);
    }

    public async launchApp(deviceId: string, packageName: string): Promise<boolean> {
        return this.targetAppService.launchApp(deviceId, packageName);
    }

    // Logcat
    public createSession(name: string, device: AdbDevice): LogcatSession {
        return this.logcatService.createSession(name, device);
    }

    public getSessions(): LogcatSession[] {
        return this.logcatService.getSessions();
    }

    public getSession(id: string): LogcatSession | undefined {
        return this.logcatService.getSession(id);
    }

    public removeSession(id: string) {
        this.logcatService.removeSession(id);
    }

    public async startSession(sessionId: string) {
        return this.logcatService.startSession(sessionId);
    }

    public stopSession(sessionId: string) {
        this.logcatService.stopSession(sessionId);
    }

    public addTag(sessionId: string, tag: LogcatTag) {
        this.logcatService.addTag(sessionId, tag);
    }

    public removeTag(sessionId: string, tagId: string) {
        this.logcatService.removeTag(sessionId, tagId);
    }

    public updateTag(sessionId: string, tag: LogcatTag) {
        this.logcatService.updateTag(sessionId, tag);
    }

    public toggleSessionTimeFilter(sessionId: string) {
        this.logcatService.toggleSessionTimeFilter(sessionId);
    }

    // Device Controls
    public async captureScreenshot(deviceId: string, localOutputPath: string): Promise<boolean> {
        return this.deviceService.captureScreenshot(deviceId, localOutputPath);
    }

    public isDeviceRecording(deviceId: string): boolean {
        return this.deviceService.isDeviceRecording(deviceId);
    }

    public isDeviceStopping(deviceId: string): boolean {
        return this.deviceService.isDeviceStopping(deviceId);
    }

    public async startRecording(deviceId: string): Promise<boolean> {
        return this.deviceService.startRecording(deviceId);
    }

    public async stopRecording(deviceId: string): Promise<void> {
        return this.deviceService.stopRecording(deviceId);
    }

    public async getShowTouchesState(deviceId: string): Promise<boolean> {
        return this.deviceService.getShowTouchesState(deviceId);
    }

    public async setShowTouchesState(deviceId: string, enable: boolean): Promise<void> {
        return this.deviceService.setShowTouchesState(deviceId, enable);
    }

    public async toggleShowTouches(deviceId: string): Promise<void> {
        return this.deviceService.toggleShowTouches(deviceId);
    }

    public async getSystemInfo(deviceId: string): Promise<string> {
        return this.deviceService.getSystemInfo(deviceId);
    }

    public async getSystemProperties(deviceId: string): Promise<string> {
        return this.deviceService.getSystemProperties(deviceId);
    }

    public async installApk(deviceId: string, filePath: string): Promise<boolean> {
        return this.deviceService.installApk(deviceId, filePath);
    }

    public async runDumpsysAudioPolicy(deviceId: string): Promise<string> {
        return this.deviceService.runDumpsysAudioPolicy(deviceId);
    }

    public async runDumpsysMediaSession(deviceId: string): Promise<string> {
        return this.deviceService.runDumpsysMediaSession(deviceId);
    }

    public async runDumpsysAudioFlinger(deviceId: string): Promise<string> {
        return this.deviceService.runDumpsysAudioFlinger(deviceId);
    }

    public dispose() {
        this.logcatService.dispose();
        // deviceService doesn't have disposable resources (process cleanup handles itself or on demand)
        // targetAppService doesn't have disposable resources
        this._onDidChangeSessions.dispose();
    }
}
