export { LogClient } from './client';
export {
  LogBufferFullError,
  LogClientClosedError,
  LogClientError,
  LogValidationError,
} from './errors';
export { defaultIdFactory } from './id';
export { KafkaProducerAdapter, type KafkaProducerAdapterOptions } from './producer';
export type {
  AuthOptions,
  BatchOptions,
  CompressionType,
  FailureMode,
  LogClientOptions,
  LogClientStats,
  LogErrorContext,
  LogErrorPhase,
  LogRecordInput,
  PayloadSizeWarning,
  ProducerLike,
  ProducerMessage,
  RetryOptions,
  SendResult,
  SendStatus,
} from './types';
