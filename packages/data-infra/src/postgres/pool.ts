import { Pool } from 'pg';

export interface DataPostgresQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount?: number | null;
}

export interface DataPostgresClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<DataPostgresQueryResult>;
  release(): void;
}

export interface DataPostgresPool {
  connect(): Promise<DataPostgresClient>;
  end(): Promise<void>;
}

export function createDataPostgresPool(options: {
  readonly connectionString: string;
  readonly applicationName: string;
  readonly maximumConnections?: number;
}): DataPostgresPool {
  if (
    options.connectionString.length < 1 ||
    !/^[a-z][a-z0-9-]{2,62}$/.test(options.applicationName) ||
    (options.maximumConnections !== undefined &&
      (!Number.isSafeInteger(options.maximumConnections) ||
        options.maximumConnections < 1 ||
        options.maximumConnections > 20))
  ) {
    throw new Error('Invalid Data Foundation PostgreSQL pool configuration.');
  }
  return new Pool({
    application_name: options.applicationName,
    connectionString: options.connectionString,
    max: options.maximumConnections ?? 5,
  });
}
