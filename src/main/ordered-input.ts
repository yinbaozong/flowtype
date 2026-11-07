/** Only text delivery waits for older turns; microphone capture never does. */
export class OrderedInput {
  private tail = Promise.resolve()

  begin(): { enqueue(job: () => Promise<void>): void; finish(): Promise<void> } {
    let pending = this.tail
    let release!: () => void
    let closed = false
    const drained = new Promise<void>(resolve => { release = resolve })
    this.tail = drained
    return {
      enqueue(job) {
        if (!closed) pending = pending.then(job).catch(() => undefined)
      },
      finish() {
        if (!closed) { closed = true; void pending.then(release) }
        return drained
      }
    }
  }
}
