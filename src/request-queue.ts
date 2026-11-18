/**
 * Bounded in-memory request queue.
 *
 * - At most `concurrency` jobs run at once.
 * - At most `maxSize` jobs wait. Beyond that, enqueue() rejects immediately
 *   (QueueFullError) so memory and load stay bounded under bursts.
 * - Jobs are removed from the queue as soon as they start running; finished
 *   jobs are never retained.
 * - Jobs waiting longer than `waitTimeoutMs` are dropped (QueueTimeoutError).
 */
export class QueueFullError extends Error {
  constructor() {
    super("Request queue is full");
  }
}

export class QueueTimeoutError extends Error {
  constructor() {
    super("Timed out waiting in request queue");
  }
}

interface Pending {
  run: () => Promise<void>;
  start: () => void;
  fail: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

export class RequestQueue {
  private waiting: Pending[] = [];
  private active = 0;

  constructor(
    private readonly maxSize: number,
    private readonly concurrency: number,
    private readonly waitTimeoutMs: number,
  ) {}

  get stats() {
    return { waiting: this.waiting.length, active: this.active, maxSize: this.maxSize, concurrency: this.concurrency };
  }

  /** Resolves when the job completes; rejects if queue full/timed out or job throws. */
  enqueue(job: () => Promise<void>): Promise<void> {
    if (this.active >= this.concurrency && this.waiting.length >= this.maxSize) {
      return Promise.reject(new QueueFullError());
    }
    return new Promise<void>((resolve, reject) => {
      const item: Pending = {
        run: job,
        start: () => {
          if (item.timer) clearTimeout(item.timer);
          this.active++;
          job()
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              this.drain();
            });
        },
        fail: reject,
      };
      if (this.active < this.concurrency) {
        item.start();
        return;
      }
      if (this.waitTimeoutMs > 0) {
        item.timer = setTimeout(() => {
          const i = this.waiting.indexOf(item);
          if (i !== -1) {
            this.waiting.splice(i, 1);
            item.fail(new QueueTimeoutError());
          }
        }, this.waitTimeoutMs);
      }
      this.waiting.push(item);
    });
  }

  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      this.waiting.shift()!.start();
    }
  }
}

export function envInt(name: string, fallback: number, min = 0): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}
