import type { StructuredLogger } from './types.js';

type LogLevel = 'info' | 'warn' | 'error';

function errorFields(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    errorName: error.name,
    errorMessage: error.message,
    ...(error.stack === undefined ? {} : { errorStack: error.stack }),
  };
}

export class ConsoleJsonLogger implements StructuredLogger {
  info(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.write('error', event, fields);
  }

  private write(
    level: LogLevel,
    event: string,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    });
    if (level === 'error') {
      console.error(record);
    } else {
      console.log(record);
    }
  }
}

export function toLogFields(error: unknown): Readonly<Record<string, unknown>> {
  return errorFields(error);
}
