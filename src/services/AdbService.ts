import * as vscode from 'vscode';

import { AdbDevice, LogcatSession, LogcatTag } from '../models/AdbModels';

import { Logger } from './Logger';
import { AdbClient } from './adb/AdbClient';
import { AdbDeviceService } from './adb/AdbDeviceService';
import { AdbLogcatService } from './adb/AdbLogcatService';
import { AdbTargetAppService } from './adb/AdbTargetAppService';

export class AdbService implements vscode.Disposable {
    private client: AdbClient;
    private deviceService: AdbDeviceService;
    private targetAppService: AdbTargetAppService;
    private logcatService: AdbLogcatService;
    private disposables: vscode.Disposable[] = [];

    // Events need to be aggregated or exposed from sub-services
    private _onDidChangeSessions = new vscode.EventEmitter<void>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    constructor(private logger: Logger) {
        this.client = new AdbClient(logger);
        this.deviceService = new AdbDeviceService(logger, this.client);
        this.targetAppService = new AdbTargetAppService(logger, this.client);
        this.logcatService = new AdbLogcatService(logger, this.client, this.targetAppService);

        // Forward events
        this.disposables.push(
            this.logcatService.onDidChangeSessions(() => this._onDidChangeSessions.fire()),
            this.targetAppService.onDidChangeTargetApp(() => this._onDidChangeSessions.fire()),
            this.deviceService.onDidChangeRecordingStatus(() => this._onDidChangeSessions.fire())
        );
    }

    /** Returns connected ADB devices with their target app state synchronized. */
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

        this.targetAppService.syncLaunchableAppScans(devices);
        return devices;
    }

    /** Returns all installed package names on the device, sorted alphabetically. */
    public async getInstalledPackages(deviceId: string): Promise<string[]> {
        return this.targetAppService.getInstalledPackages(deviceId);
    }

    /** Returns apps with launcher activities on the device. */
    public async getLaunchableApps(deviceId: string): Promise<{ packageName: string, componentName: string }[]> {
        return this.targetAppService.getLaunchableApps(deviceId);
    }

    /** Returns the set of third-party (non-system) packages on the device. */
    public async getThirdPartyPackages(deviceId: string): Promise<Set<string>> {
        return this.targetAppService.getThirdPartyPackages(deviceId);
    }

    /** Returns the set of currently running app package names on the device. */
    public async getRunningApps(deviceId: string): Promise<Set<string>> {
        return this.targetAppService.getRunningApps(deviceId);
    }

    /** Returns the PID of a running app, or undefined if not found. */
    public async getAppPid(deviceId: string, packageName: string): Promise<string | undefined> {
        return this.targetAppService.getAppPid(deviceId, packageName);
    }

    /** Sets the target app for logcat filtering on the given device. */
    public setTargetApp(device: AdbDevice, packageName: string) {
        this.targetAppService.setTargetApp(device, packageName);
    }

    /** Uninstalls an app from the device. */
    public async uninstallApp(deviceId: string, packageName: string): Promise<boolean> {
        return this.targetAppService.uninstallApp(deviceId, packageName);
    }

    /** Clears all data for an app on the device. */
    public async clearAppStorage(deviceId: string, packageName: string): Promise<boolean> {
        return this.targetAppService.clearAppStorage(deviceId, packageName);
    }

    /** Clears the cache directories for an app on the device. */
    public async clearAppCache(deviceId: string, packageName: string): Promise<boolean> {
        return this.targetAppService.clearAppCache(deviceId, packageName);
    }

    /** Runs `dumpsys package` for the specified app. */
    public async runDumpsysPackage(deviceId: string, packageName: string): Promise<string> {
        return this.targetAppService.runDumpsysPackage(deviceId, packageName);
    }

    /** Runs `dumpsys meminfo` for the specified app. */
    public async runDumpsysMeminfo(deviceId: string, packageName: string): Promise<string> {
        return this.targetAppService.runDumpsysMeminfo(deviceId, packageName);
    }

    /** Runs `dumpsys activity` for the specified app. */
    public async runDumpsysActivity(deviceId: string, packageName: string): Promise<string> {
        return this.targetAppService.runDumpsysActivity(deviceId, packageName);
    }

    /** Launches an app on the device, optionally targeting a specific component. */
    public async launchApp(deviceId: string, packageName: string, componentName?: string): Promise<boolean> {
        return this.targetAppService.launchApp(deviceId, packageName, componentName);
    }

    /** Creates a new logcat session for the given device. */
    public createSession(name: string, device: AdbDevice): LogcatSession {
        return this.logcatService.createSession(name, device);
    }

    /** Returns all active logcat sessions. */
    public getSessions(): LogcatSession[] {
        return this.logcatService.getSessions();
    }

    /** Returns a logcat session by ID, or undefined if not found. */
    public getSession(id: string): LogcatSession | undefined {
        return this.logcatService.getSession(id);
    }

    /** Stops and removes a logcat session. */
    public removeSession(id: string) {
        this.logcatService.removeSession(id);
    }

    /** Starts capturing logcat output for the given session. */
    public async startSession(sessionId: string) {
        return this.logcatService.startSession(sessionId);
    }

    /** Stops capturing logcat output for the given session. */
    public stopSession(sessionId: string) {
        this.logcatService.stopSession(sessionId);
    }

    /** Adds a tag filter to a stopped logcat session. */
    public addTag(sessionId: string, tag: LogcatTag) {
        this.logcatService.addTag(sessionId, tag);
    }

    /** Removes a tag filter from a stopped logcat session. */
    public removeTag(sessionId: string, tagId: string) {
        this.logcatService.removeTag(sessionId, tagId);
    }

    /** Updates an existing tag filter on a stopped logcat session. */
    public updateTag(sessionId: string, tag: LogcatTag) {
        this.logcatService.updateTag(sessionId, tag);
    }

    /** Toggles whether a session starts capturing from the current time or from the beginning. */
    public toggleSessionTimeFilter(sessionId: string) {
        this.logcatService.toggleSessionTimeFilter(sessionId);
    }

    /** Captures a screenshot from the device and saves it to the local path. */
    public async captureScreenshot(deviceId: string, localOutputPath: string): Promise<boolean> {
        return this.deviceService.captureScreenshot(deviceId, localOutputPath);
    }

    /** Returns whether the device is currently recording its screen. */
    public isDeviceRecording(deviceId: string): boolean {
        return this.deviceService.isDeviceRecording(deviceId);
    }

    /** Returns whether the device is in the process of stopping a recording. */
    public isDeviceStopping(deviceId: string): boolean {
        return this.deviceService.isDeviceStopping(deviceId);
    }

    /** Starts screen recording on the device. */
    public async startRecording(deviceId: string): Promise<boolean> {
        return this.deviceService.startRecording(deviceId);
    }

    /** Stops screen recording on the device and pulls the video file. */
    public async stopRecording(deviceId: string): Promise<void> {
        return this.deviceService.stopRecording(deviceId);
    }

    /** Returns whether the show-touches overlay is enabled on the device. */
    public async getShowTouchesState(deviceId: string): Promise<boolean> {
        return this.deviceService.getShowTouchesState(deviceId);
    }

    /** Enables or disables the show-touches overlay on the device. */
    public async setShowTouchesState(deviceId: string, enable: boolean): Promise<void> {
        return this.deviceService.setShowTouchesState(deviceId, enable);
    }

    /** Toggles the show-touches overlay on the device. */
    public async toggleShowTouches(deviceId: string): Promise<void> {
        return this.deviceService.toggleShowTouches(deviceId);
    }

    /** Returns a formatted summary of the device's system information. */
    public async getSystemInfo(deviceId: string): Promise<string> {
        return this.deviceService.getSystemInfo(deviceId);
    }

    /** Returns raw `getprop` output for the device. */
    public async getSystemProperties(deviceId: string): Promise<string> {
        return this.deviceService.getSystemProperties(deviceId);
    }

    /** Installs an APK file on the device. */
    public async installApk(deviceId: string, filePath: string): Promise<boolean> {
        return this.deviceService.installApk(deviceId, filePath);
    }

    /** Runs `dumpsys media.audio_policy` on the device. */
    public async runDumpsysAudioPolicy(deviceId: string): Promise<string> {
        return this.deviceService.runDumpsysAudioPolicy(deviceId);
    }

    /** Runs `dumpsys media_session` on the device. */
    public async runDumpsysMediaSession(deviceId: string): Promise<string> {
        return this.deviceService.runDumpsysMediaSession(deviceId);
    }

    /** Runs `dumpsys media.audio_flinger` on the device. */
    public async runDumpsysAudioFlinger(deviceId: string): Promise<string> {
        return this.deviceService.runDumpsysAudioFlinger(deviceId);
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.logcatService.dispose();
        this.deviceService.dispose();
        this.targetAppService.dispose();
        this._onDidChangeSessions.dispose();
    }
}
