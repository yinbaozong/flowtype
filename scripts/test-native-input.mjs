import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
const source = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
let definitions = ''
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'definitions' && ts.isNoSubstitutionTemplateLiteral(node.initializer)) definitions = node.initializer.text
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(definitions.includes('FlowTypePaste'))
const script = `${definitions}\nif ([FlowTypePaste]::Matches([IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Invalid target accepted' }; Write-Output 'PASS native compilation and invalid target rejection'`
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
assert.equal(result.status, 0, result.stderr)
assert.match(result.stdout, /PASS native/)
console.log(result.stdout.trim())
const hook = readFileSync('resources/windows-key-hook.ps1', 'utf8')
const end = hook.lastIndexOf('[FlowTypeHotkeyHook]::Run')
const compile = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference = 'SilentlyContinue'\n" + hook.slice(hook.indexOf("$source = @'"), end) + "\nWrite-Output 'PASS hook compilation without installing hooks'", 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
assert.equal(compile.status, 0, compile.stderr)
assert.equal(compile.stderr, '', compile.stderr)
console.log(compile.stdout.trim())
const implementation = ts.transpileModule(readFileSync('src/main/input-worker.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { runInput, stopInputWorker } = await import(`data:text/javascript;base64,${Buffer.from(implementation).toString('base64')}`)
const noInputDefinitions = `Add-Type -TypeDefinition @'
using System;
public static class FlowTypePaste {
  public static bool Matches(IntPtr window, IntPtr focus) { return window.ToInt64() == 123 && focus.ToInt64() == 456; }
  public static IntPtr ResolveFocus(IntPtr window, IntPtr focus) { return Matches(window, focus) ? focus : IntPtr.Zero; }
  public static bool Paste(IntPtr focus) { return true; }
  public static bool UndoWithKeyboard() { return true; }
}
'@`
const request = (window, focus, operation) => new Promise(resolve => runInput(noInputDefinitions, window, focus, operation).once('close', resolve))
try {
  assert.equal(await request(123, 456, 'paste'), 0, 'persistent worker accepts matching target')
  assert.equal(await request(123, 456, 'undo'), 0, 'same worker handles next request')
  assert.equal(await request(123, 789, 'paste'), 2, 'changed input control blocks insertion')
} finally { stopInputWorker() }
console.log('PASS persistent worker protocol, sequential commands and focus rejection (no keyboard injection)')
