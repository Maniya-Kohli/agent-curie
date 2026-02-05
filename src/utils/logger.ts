import * as fs from "fs";
import * as path from "path";

enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  SUCCESS = "SUCCESS",
}

class Logger {
  private logFile = path.join(process.cwd(), "bot.log");

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  private colorize(level: LogLevel, message: string): string {
    const colors = {
      [LogLevel.INFO]: "\x1b[36m", // Cyan
      [LogLevel.WARN]: "\x1b[33m", // Yellow
      [LogLevel.ERROR]: "\x1b[31m", // Red
      [LogLevel.SUCCESS]: "\x1b[32m", // Green
    };
    const reset = "\x1b[0m";
    return `${colors[level]}${message}${reset}`;
  }

  private writeToFile(formattedMessage: string) {
    fs.appendFileSync(this.logFile, formattedMessage + "\n");
  }

  info(msg: string) {
    const formatted = this.formatMessage(LogLevel.INFO, msg);
    console.log(this.colorize(LogLevel.INFO, formatted));
    this.writeToFile(formatted);
  }

  success(msg: string) {
    const formatted = this.formatMessage(LogLevel.SUCCESS, msg);
    console.log(this.colorize(LogLevel.SUCCESS, formatted));
    this.writeToFile(formatted);
  }

  warn(msg: string) {
    const formatted = this.formatMessage(LogLevel.WARN, msg);
    console.warn(this.colorize(LogLevel.WARN, formatted));
    this.writeToFile(formatted);
  }

  error(msg: string, err?: any) {
    const errorMessage = err ? `${msg} | ${err.message || err}` : msg;
    const formatted = this.formatMessage(LogLevel.ERROR, errorMessage);
    console.error(this.colorize(LogLevel.ERROR, formatted));
    this.writeToFile(formatted);
  }
}

export const logger = new Logger();
