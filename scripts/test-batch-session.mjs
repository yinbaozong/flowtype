import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const output = ts.transpileModule(readFileSync('src/main/batch-session.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { BatchSession } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
const states = [], inputs = []
let calls = 0
const session = new BatchSession(async wav => {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.ok(wav.length <= 60 * 32000 + 44)
  calls++
  if (calls === 2) throw new Error('offline')
  return `part${calls}.`
}, state => states.push(state), text => inputs.push(text))
session.connect()
session.append(new Uint8Array(125 * 32000))
session.finish()
await new Promise(resolve => setImmediate(resolve))
assert.equal(states.at(-1).canRetry, true)
assert.equal(session.text, 'part1.')
assert.deepEqual(inputs, [], 'batch mode waits for the whole result')
session.retry()
await new Promise(resolve => setImmediate(resolve))
assert.equal(calls, 4, 'retry skips the completed first minute')
assert.equal(session.text, 'part1.part3.part4.')
assert.deepEqual(inputs, ['part1.part3.part4.'])
assert.equal(states.at(-1).phase, 'done')
session.dispose()
const failed = []
const failure = new BatchSession(async () => { throw new Error('offline') }, state => failed.push(state), () => {})
failure.append(new Uint8Array(32000)); failure.finish()
await new Promise(resolve => setImmediate(resolve))
failure.retry()
await new Promise(resolve => setImmediate(resolve))
assert.equal(failed.at(-1).canRetry, false)
failure.dispose()
console.log('PASS batch mode: bounded WAV chunks, partial preservation, retry checkpoint, one insertion, retry release')
