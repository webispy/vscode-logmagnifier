import * as vscode from 'vscode';
import { Constants } from '../Constants';

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel(Constants.ExtensionDisplayName);
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public info(message: string): void {
        this.log('INFO', message);
    }

    public warn(message: string): void {
        this.log('WARN', message);
    }

    public error(message: string): void {
        this.log('ERROR', message);
    }

    private log(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    }

    public show(): void {
        this.outputChannel.show(true);
    }
}
