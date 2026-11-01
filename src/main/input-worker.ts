import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'

let worker: ChildProcessWithoutNullStreams | null = null
let ready: Promise<void> | null = null
let sequence = 0
const jobs = new Map<number, (code: number) => void>()

export function stopInputWorker(): void {
  const child = worker
  worker = null
  ready = null
  child?.kill()
  for (const finish of [...jobs.values()]) finish(2)
}

export function runInput(definitions: string, hwnd: number, focus: number, operation: 'paste' | 'undo'): EventEmitter {
  const job = new EventEmitter()
  const id = ++sequence
  const script = `${definitions}
[Console]::WriteLine('READY')
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $job = $line | ConvertFrom-Json
    $code = 2
    $target = [FlowTypePaste]::ResolveFocus([IntPtr]$job.hwnd, [IntPtr]$job.focus)
    if ($target -ne [IntPtr]::Zero) {
      $ok = if ($job.operation -eq 'undo') { [FlowTypePaste]::UndoWithKeyboard() }
      else { [FlowTypePaste]::Paste($target) }
      if ($ok) { $code = 0 }
    }
    [Console]::WriteLine(('RESULT {0} {1}' -f $job.id, $code))
  } catch { [Console]::WriteLine(('RESULT {0} 2' -f $job.id)) }
}`
  if (!worker) {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
    worker = child
    ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Input helper timeout')); if (worker === child) stopInputWorker() }, 8000)
      let output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        output += chunk
        let index: number
        while ((index = output.indexOf('\n')) >= 0) {
          const line = output.slice(0, index).trim()
          output = output.slice(index + 1)
          if (line === 'READY') { clearTimeout(timer); resolve() }
          const match = line.match(/^RESULT (\d+) (\d+)$/)
          if (match) jobs.get(Number(match[1]))?.(Number(match[2]))
        }
      })
      const exited = (): void => {
        clearTimeout(timer)
        reject(new Error('Input helper exited'))
        if (worker === child) stopInputWorker()
      }
      child.once('error', exited)
      child.once('close', exited)
      child.stdin.on('error', exited)
      child.stderr.resume()
    })
  }
  const timer = setTimeout(() => { finish(2) }, 10_000)
  function finish(code: number): void {
    if (!jobs.delete(id)) return
    clearTimeout(timer)
    job.emit('close', code)
  }
  jobs.set(id, finish)
  void ready!.then(() => {
    if (jobs.has(id)) worker?.stdin.write(`${JSON.stringify({ id, hwnd, focus: focus || hwnd, operation })}\n`)
  }).catch(() => finish(2))
  return job
}
