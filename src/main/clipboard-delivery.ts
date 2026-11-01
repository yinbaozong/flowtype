export interface ClipboardAdapter<T> {
  snapshot(): T
  write(text: string): void
  owns(text: string): boolean
  restore(value: T): void
}

export async function deliverClipboard<T>(text: string, clipboard: ClipboardAdapter<T>, send: () => Promise<boolean>, valid: () => boolean): Promise<boolean> {
  if (!valid()) return false
  const before = clipboard.snapshot()
  clipboard.write(text)
  try {
    const accepted = await send()
    // SendInput acknowledges enqueueing, not the target application's paste.
    if (accepted) await new Promise(resolve => setTimeout(resolve, 750))
    return accepted
  }
  finally { if (clipboard.owns(text)) clipboard.restore(before) }
}
