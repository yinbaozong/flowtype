import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const output = ts.transpileModule(readFileSync('src/main/clipboard-delivery.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { deliverClipboard } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
let contents = 'previous clipboard'
const adapter = { snapshot: () => contents, write: text => { contents = text }, owns: text => contents === text, restore: value => { contents = value } }
let received
const delayedPaste = new Promise(resolve => {
  void deliverClipboard('recognized sentence', adapter, async () => {
    setTimeout(() => { received = contents; resolve() }, 40)
    return true
  }, () => true)
})
await delayedPaste
assert.equal(received, 'recognized sentence', 'target reads clipboard after SendInput returns')
await new Promise(resolve => setTimeout(resolve, 800))
assert.equal(contents, 'previous clipboard')
let sendCount = 0
assert.equal(await deliverClipboard('stale sentence', adapter, async () => { sendCount++; return true }, () => false), false)
assert.equal(sendCount, 0)
await deliverClipboard('second sentence', adapter, async () => { contents = 'new user copy'; return true }, () => true)
assert.equal(contents, 'new user copy', 'never overwrite a newer user clipboard')
console.log('PASS clipboard delivery: delayed target read, conditional restore, stale session rejection, new user clipboard preserved')
