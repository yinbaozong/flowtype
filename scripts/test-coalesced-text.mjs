import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync('src/main/coalesced-text.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { CoalescedText } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const sent = []
let release, queued, valid = true
const output = new CoalescedText(job => { queued = Promise.resolve().then(job) }, async text => {
  sent.push(text)
  if (sent.length === 1) await new Promise(resolve => { release = resolve })
  return true
}, () => valid)
output.append('first')
await Promise.resolve()
output.append('second')
output.append('third')
release()
await queued
assert.deepEqual(sent, ['first', 'secondthird'], 'merge new prefixes while the prior paste is settling')
valid = false
output.append('stale')
assert.deepEqual(sent, ['first', 'secondthird'])
console.log('PASS incremental output coalescing and stale session rejection')
