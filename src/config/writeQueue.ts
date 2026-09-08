export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private count = 0;

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.count++;
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => {
        this.count--;
      },
      () => {
        this.count--;
      },
    );
    return run;
  }

  pending(): number {
    return this.count;
  }
}
