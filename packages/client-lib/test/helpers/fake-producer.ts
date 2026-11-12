import type { ProducerLike, ProducerMessage } from '../../src/types';

export interface RecordedBatch {
  topic: string;
  messages: ProducerMessage[];
}

export interface FakeProducerOptions {
  /** Return an Error to reject the call; return undefined to succeed. */
  failWith?: (call: number, topic: string, messages: ProducerMessage[]) => Error | undefined;
  /** Number of initial sendBatch calls to hold until release() is called. */
  gateCalls?: number;
}

/** In-memory ProducerLike used by unit tests. */
export class FakeProducer implements ProducerLike {
  /** Every successful sendBatch call. */
  readonly batches: RecordedBatch[] = [];
  /** Every sendBatch call, including ones that failed. */
  readonly attempts: RecordedBatch[] = [];
  sendCalls = 0;
  disconnectCalls = 0;

  readonly #options: FakeProducerOptions;
  #gates: Array<() => void> = [];
  #gatedCalls = 0;

  constructor(options: FakeProducerOptions = {}) {
    this.#options = options;
  }

  /** Flattened messages from successful batches. */
  get messages(): ProducerMessage[] {
    return this.batches.flatMap((batch) => batch.messages);
  }

  get lastBatch(): RecordedBatch | undefined {
    return this.batches[this.batches.length - 1];
  }

  async sendBatch(topic: string, messages: ProducerMessage[]): Promise<void> {
    this.sendCalls++;
    const recorded: RecordedBatch = {
      topic,
      messages: messages.map((message) => ({ ...message })),
    };
    this.attempts.push(recorded);
    if (this.#gatedCalls < (this.#options.gateCalls ?? 0)) {
      this.#gatedCalls++;
      await new Promise<void>((resolve) => {
        this.#gates.push(resolve);
      });
    }
    const failure = this.#options.failWith?.(this.sendCalls, topic, messages);
    if (failure) {
      throw failure;
    }
    this.batches.push(recorded);
  }

  /** Releases every sendBatch call currently waiting on a gate. */
  release(): void {
    const gates = this.#gates;
    this.#gates = [];
    for (const gate of gates) {
      gate();
    }
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
  }
}
