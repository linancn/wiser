export interface ClockPort {
  now(): string;
}

export interface IdGeneratorPort {
  generateId(): string;
}
