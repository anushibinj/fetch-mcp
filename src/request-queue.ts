/**
 * Unbounded in-memory FIFO request queue with a concurrency cap.
 *
 * - At most `concurrency` jobs run at once.
 * - Nothing is ever rejected: extra jobs wait in the queue.
 * - A job is removed from the queue the moment it starts, and finished jobs
 *   are never retained, so the queue only holds work that hasn't started.
 */
export class RequestQueue {
  private waiting: Array<() => void> = [];
  private head = 0; // index of next waiting job (avoids O(n) shift())
  private active = 0;

  constructor(private readonly concurrency: number) {}

  get stats() {
    return { waiting: this.waiting.length - this.head, active: this.active, concurrency: this.concurrency };
  }

  /** Resolves when the job completes; rejects only if the job itself throws. */
  enqueue(job: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const start = () => {
        this.active++;
        job()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.drain();
          });
      };
      if (this.active < this.concurrency) start();
      else this.waiting.push(start);
    });
  }

  private drain(): void {
    while (this.active < this.concurrency && this.head < this.waiting.length) {
      const next = this.waiting[this.head];
      this.waiting[this.head++] = undefined as unknown as () => void; // release reference
      next();
    }
    // Compact once fully drained, or when the consumed prefix gets large.
    if (this.head === this.waiting.length) {
      this.waiting = [];
      this.head = 0;
    } else if (this.head > 1024 && this.head * 2 > this.waiting.length) {
      this.waiting = this.waiting.slice(this.head);
      this.head = 0;
    }
  }
}

export function envInt(name: string, fallback: number, min = 0): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}
