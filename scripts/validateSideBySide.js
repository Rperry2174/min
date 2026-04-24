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

const requiredFiles = [
  'package.json',
  'main/main.js',
  'js/default.js',
  'js/runtime/electronRuntime.js',
  'tauri-min/package.json',
  'tauri-min/web/index.html',
  'tauri-min/web/runtime.js',
  'tauri-min/web/tabEngine.js',
  'tauri-min/src-tauri/tauri.conf.json',
  'tauri-min/src-tauri/src/lib.rs',
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

function validateStructure () {
  const missing = requiredFiles.filter(function (relativePath) {
    return !fileExists(relativePath)
  })

  requiredFiles.forEach(function (relativePath) {
    printResult('file ' + relativePath, fileExists(relativePath))
  })

  return missing
}

function validateScripts () {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'))
  const requiredScripts = [
    'start:electron',
    'start:tauri',
    'build:electron',
    'tauri:check',
    'cursor:director',
    'validate:side-by-side'
  ]

  const missing = requiredScripts.filter(function (script) {
    return !pkg.scripts || !pkg.scripts[script]
  })

  requiredScripts.forEach(function (script) {
    printResult('script ' + script, !missing.includes(script))
  })

  return missing
}

function validateDryRun () {
  const result = runCommand(process.execPath, ['scripts/cursor-tauri-director.js', '--dry-run'])
  const passed = result.status === 0
  printResult('cursor director dry run', passed)

  if (!passed) {
    console.log(result.stdout)
    console.error(result.stderr)
  }

  return passed
}

function validateFullCommands () {
  const commands = [
    ['npm', ['test']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'tauri:check']]
  ]

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

function main () {
  const full = process.argv.includes('--full')
  const missingFiles = validateStructure()
  const missingScripts = validateScripts()
  const dryRunPassed = validateDryRun()
  const fullResults = full ? validateFullCommands() : []
  const fullPassed = fullResults.every(function (result) {
    return result.status === 0
  })

  if (missingFiles.length || missingScripts.length || !dryRunPassed || (full && !fullPassed)) {
    process.exit(1)
  }

  console.log(full ? 'Side-by-side validation passed.' : 'Side-by-side structural validation passed. Use --full to run build gates.')
}

main()
