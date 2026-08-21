export class DataFoundationDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DataFoundationDomainError';
  }
}
