/**
 * Module overview:
 * Creates and writes to the extension output channel used for diagnostics
 * and user-visible runtime logs.
 */
import * as vscode from 'vscode';

const autoRevealOutputChannelOnLog = false;

export class OutputChannelLogger {
  private outputChannel: vscode.OutputChannel | undefined;

  public init(): void {
    if (this.outputChannel) {
      return;
    }

    this.outputChannel = vscode.window.createOutputChannel('Mekatrol PyDevice');
  }

  public log(content: string, show = true): void {
    if (!this.outputChannel) {
      this.init();
    }

    this.outputChannel!.appendLine(content);
    if (show && autoRevealOutputChannelOnLog) {
      this.outputChannel!.show(true);
    }
  }
}

export const outputChannelLogger = new OutputChannelLogger();
