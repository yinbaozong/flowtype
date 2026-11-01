export class CoalescedText {
  private pending = ''
  private scheduled = false
  constructor(private schedule: (job: () => Promise<void>) => void, private send: (text: string) => Promise<boolean>, private valid: () => boolean) {}
  append(text: string): void {
    if (!this.valid()) return
    this.pending += text
    if (this.scheduled) return
    this.scheduled = true
    this.schedule(async () => {
      try {
        while (this.pending && this.valid()) {
          const next = this.pending
          this.pending = ''
          if (!await this.send(next)) break
        }
      } finally { this.pending = ''; this.scheduled = false }
    })
  }
}
