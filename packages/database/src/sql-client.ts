export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult<T>>;
}
