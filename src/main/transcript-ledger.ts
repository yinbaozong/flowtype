export interface TranscriptItem {
  id: string
  previousId?: string
  draft: string
  text?: string
  endMs?: number
  emitted: boolean
  linked: boolean
}

/** One ledger per provider connection; late events never mutate another session. */
export class TranscriptLedger {
  private items = new Map<string, TranscriptItem>()
  private closed = false

  update(id: string, text: string, stash: string): void {
    if (this.closed) return
    const item = this.item(id)
    if (item.text === undefined) item.draft = text + stash
  }

  link(id: string, previousId?: string): void {
    if (!this.closed) {
      const item = this.item(id)
      item.previousId = previousId
      item.linked = true
    }
  }

  complete(id: string, text: string): void {
    if (this.closed) return
    const item = this.item(id)
    if (item.text !== undefined) return
    item.text = text
    item.draft = ''
  }

  markAudioEnd(id: string, endMs: number): void {
    if (!this.closed && Number.isFinite(endMs) && endMs >= 0) this.item(id).endMs = endMs
  }

  drain(): TranscriptItem[] {
    if (this.closed) return []
    const result: TranscriptItem[] = []
    let changed = true
    while (changed) {
      changed = false
      for (const item of this.items.values()) {
        if (item.emitted || !item.linked || item.text === undefined) continue
        if (item.previousId && !this.items.get(item.previousId)?.emitted) continue
        item.emitted = true
        result.push({ ...item })
        changed = true
      }
    }
    return result
  }

  get draft(): string {
    return [...this.items.values()].filter(item => !item.emitted).map(item => item.text ?? item.draft).join('')
  }

  close(): void { this.closed = true }

  private item(id: string): TranscriptItem {
    let item = this.items.get(id)
    if (!item) {
      item = { id, draft: '', emitted: false, linked: false }
      this.items.set(id, item)
    }
    return item
  }
}
