/** Base class for every error thrown by @centurion/client-lib. */
export class LogClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LogClientError';
  }
}

/** A record did not satisfy the shared log envelope contract. */
export class LogValidationError extends LogClientError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LogValidationError';
  }
}

/** A send was attempted after close(), or while the client is closing. */
export class LogClientClosedError extends LogClientError {
  constructor(message = 'LogClient is closed') {
    super(message);
    this.name = 'LogClientClosedError';
  }
}

/** The bounded buffer stayed full longer than enqueueTimeoutMs. */
export class LogBufferFullError extends LogClientError {
  constructor(message = 'LogClient buffer is full') {
    super(message);
    this.name = 'LogBufferFullError';
  }
}
