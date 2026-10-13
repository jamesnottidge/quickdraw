export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

export class UnsafeUrlError extends FetchError {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}
