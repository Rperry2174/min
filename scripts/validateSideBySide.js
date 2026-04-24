#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const rootDir = path.resolve(__dirname, '..')

function rustToolchainPath () {
  const result = spawnSync('rustup', ['which', 'cargo'], {
    encoding: 'utf-8',
    shell: false
  })

  if (result.status !== 0 || !result.stdout.trim()) {
    return process.env.HOME + '/.cargo/bin'
  }

  return path.dirname(result.stdout.trim())
}

const electronFiles = [
  'package.json',
  'main/main.js',
  'js/default.js',
  'js/runtime/electronRuntime.js'
]

const tauriFiles = [
  'tauri-min/package.json',
  'tauri-min/web/index.html',
  'tauri-min/web/runtime.js',
  'tauri-min/web/tabEngine.js',
  'tauri-min/src-tauri/tauri.conf.json',
  'tauri-min/src-tauri/src/lib.rs'
]

const migrationFiles = [
  'migration/cursor-agents/tauri-migration-dag.json',
  'docs/tauri-migration/webview-spike-gaps.md',
  'scripts/cursor-tauri-director.js'
]

function fileExists (relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath))
}

function runCommand (command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf-8',
    shell: false,
    env: Object.assign({}, process.env, {
      PATH: rustToolchainPath() + ':' + process.env.HOME + '/.cargo/bin:' + process.env.PATH
    })
  })

  return {
    command: [command].concat(args).join(' '),
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

function printResult (label, passed, detail) {
  console.log((passed ? 'PASS ' : 'FAIL ') + label + (detail ? ' - ' + detail : ''))
}

function printSection (title) {
  console.log('\n--- ' + title + ' ---')
}

function validateStructure () {
  const missing = []

  printSection('Electron Readiness')
  electronFiles.forEach(function (relativePath) {
    const exists = fileExists(relativePath)
    printResult('file ' + relativePath, exists)
    if (!exists) missing.push(relativePath)
  })

  printSection('Tauri Readiness')
  tauriFiles.forEach(function (relativePath) {
    const exists = fileExists(relativePath)
    printResult('file ' + relativePath, exists)
    if (!exists) missing.push(relativePath)
  })

  printSection('Migration Infrastructure')
  migrationFiles.forEach(function (relativePath) {
    const exists = fileExists(relativePath)
    printResult('file ' + relativePath, exists)
    if (!exists) missing.push(relativePath)
  })

  return missing
}

function validateScripts () {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'))
  const electronScripts = ['start:electron', 'build:electron']
  const tauriScripts = ['start:tauri', 'tauri:check']
  const migrationScripts = ['cursor:director', 'validate:side-by-side']
  const requiredScripts = electronScripts.concat(tauriScripts).concat(migrationScripts)

  const missing = requiredScripts.filter(function (script) {
    return !pkg.scripts || !pkg.scripts[script]
  })

  printSection('Scripts')
  console.log('  Electron: ' + electronScripts.map(function (s) { return (missing.includes(s) ? 'FAIL ' : 'PASS ') + s }).join(', '))
  console.log('  Tauri:    ' + tauriScripts.map(function (s) { return (missing.includes(s) ? 'FAIL ' : 'PASS ') + s }).join(', '))
  console.log('  Tools:    ' + migrationScripts.map(function (s) { return (missing.includes(s) ? 'FAIL ' : 'PASS ') + s }).join(', '))

  return missing
}

function validateDryRun () {
  const result = runCommand(process.execPath, ['scripts/cursor-tauri-director.js', '--dry-run'])
  const passed = result.status === 0

  printSection('Director Dry Run')
  printResult('cursor director dry run', passed)

  if (!passed) {
    console.log(result.stdout)
    console.error(result.stderr)
  } else {
    result.stdout.trim().split('\n').forEach(function (line) {
      console.log('  ' + line)
    })
  }

  return passed
}

function validateLedger () {
  const ledgerPath = path.join(rootDir, 'migration/cursor-agents/ledger.json')

  printSection('Migration Ledger')

  if (!fs.existsSync(ledgerPath)) {
    printResult('ledger.json', false, 'file not found')
    return false
  }

  let ledger
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'))
  } catch (err) {
    printResult('ledger.json', false, 'parse error: ' + err.message)
    return false
  }

  printResult('ledger.json', true)

  const runs = ledger.runs || []
  runs.forEach(function (run) {
    const passed = run.status === 'FINISHED'
    console.log('  ' + (passed ? 'PASS' : 'WARN') + ' task=' + run.taskId + ' status=' + run.status + ' branch=' + run.desiredBranchName)
  })

  if (runs.length === 0) {
    console.log('  (no runs recorded)')
  }

  return true
}

function validateFullCommands () {
  const commands = [
    ['npm', ['exec', 'standard', '--', 'js/runtime/electronRuntime.js', 'scripts/cursor-tauri-director.js', 'scripts/validateSideBySide.js', 'tauri-min/web/main.js', 'tauri-min/web/runtime.js', 'tauri-min/web/tabEngine.js']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'tauri:check']]
  ]

  printSection('Full Build Gates')

  return commands.map(function ([command, args]) {
    const result = runCommand(command, args)
    printResult(result.command, result.status === 0)
    if (result.status !== 0) {
      console.log(result.stdout)
      console.error(result.stderr)
    }
    return result
  })
}

function printReadinessSummary (missingFiles, missingScripts, dryRunPassed, ledgerOk) {
  const electronFilesMissing = missingFiles.filter(function (f) { return electronFiles.includes(f) })
  const tauriFilesMissing = missingFiles.filter(function (f) { return tauriFiles.includes(f) })
  const electronScriptsMissing = missingScripts.filter(function (s) { return ['start:electron', 'build:electron'].includes(s) })
  const tauriScriptsMissing = missingScripts.filter(function (s) { return ['start:tauri', 'tauri:check'].includes(s) })

  const electronReady = electronFilesMissing.length === 0 && electronScriptsMissing.length === 0
  const tauriReady = tauriFilesMissing.length === 0 && tauriScriptsMissing.length === 0

  console.log('\n=== Readiness Summary ===')
  console.log((electronReady ? 'PASS' : 'FAIL') + ' Electron app  (npm run start:electron)')
  console.log((tauriReady ? 'PASS' : 'FAIL') + ' Tauri app     (npm run start:tauri)')
  console.log((dryRunPassed ? 'PASS' : 'FAIL') + ' Director      (npm run cursor:director)')
  console.log((ledgerOk ? 'PASS' : 'FAIL') + ' Ledger        (migration/cursor-agents/ledger.json)')
}

function main () {
  const full = process.argv.includes('--full')
  const missingFiles = validateStructure()
  const missingScripts = validateScripts()
  const dryRunPassed = validateDryRun()
  const ledgerOk = validateLedger()
  const fullResults = full ? validateFullCommands() : []
  const fullPassed = fullResults.every(function (result) {
    return result.status === 0
  })

  printReadinessSummary(missingFiles, missingScripts, dryRunPassed, ledgerOk)

  if (missingFiles.length || missingScripts.length || !dryRunPassed || (full && !fullPassed)) {
    process.exit(1)
  }

  console.log('\n' + (full ? 'Side-by-side validation passed.' : 'Side-by-side structural validation passed. Use --full to run build gates.'))
}

main()
