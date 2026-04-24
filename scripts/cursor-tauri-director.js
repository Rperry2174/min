#!/usr/bin/env node

const fs = require('fs')
const https = require('https')
const path = require('path')

const API_ORIGIN = 'https://api.cursor.com'
const TERMINAL_RUN_STATUSES = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'])

function readJson (filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function readEnvFile (filePath) {
  const env = {}

  if (!fs.existsSync(filePath)) {
    return env
  }

  fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      return
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    env[key] = value
  })

  return env
}

function parseArgs (argv) {
  const args = {
    dryRun: true,
    maxParallel: 3,
    dagPath: path.resolve(process.cwd(), 'migration/cursor-agents/tauri-migration-dag.json'),
    ledgerPath: path.resolve(process.cwd(), 'migration/cursor-agents/ledger.json')
  }

  argv.forEach(function (arg, index) {
    if (arg === '--run') {
      args.dryRun = false
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--task') {
      args.task = argv[index + 1]
    } else if (arg.startsWith('--task=')) {
      args.task = arg.split('=')[1]
    } else if (arg === '--max-parallel') {
      args.maxParallel = Number(argv[index + 1])
    } else if (arg.startsWith('--max-parallel=')) {
      args.maxParallel = Number(arg.split('=')[1])
    } else if (arg === '--dag') {
      args.dagPath = path.resolve(process.cwd(), argv[index + 1])
    } else if (arg.startsWith('--dag=')) {
      args.dagPath = path.resolve(process.cwd(), arg.split('=')[1])
    }
  })

  return args
}

function cursorRequest (apiKey, method, pathname, body) {
  const payload = body ? JSON.stringify(body) : null

  return new Promise(function (resolve, reject) {
    const request = https.request(API_ORIGIN + pathname, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, function (response) {
      let data = ''

      response.setEncoding('utf-8')
      response.on('data', function (chunk) {
        data += chunk
      })
      response.on('end', function () {
        let parsed = null
        if (data) {
          try {
            parsed = JSON.parse(data)
          } catch (error) {
            reject(new Error('Cursor API returned non-JSON response for ' + pathname))
            return
          }
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = parsed && parsed.error ? parsed.error.message : 'HTTP ' + response.statusCode
          reject(new Error('Cursor API error on ' + pathname + ': ' + message))
          return
        }

        resolve(parsed)
      })
    })

    request.on('error', reject)

    if (payload) {
      request.write(payload)
    }

    request.end()
  })
}

function loadLedger (ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    return {
      runs: []
    }
  }

  return readJson(ledgerPath)
}

function writeLedger (ledgerPath, ledger) {
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
}

function resolvePrompt (task, dagPath) {
  const promptPath = path.resolve(path.dirname(dagPath), '../../', task.promptFile)
  return fs.readFileSync(promptPath, 'utf-8')
}

function selectTasks (dag, requestedTask) {
  if (!requestedTask) {
    return dag.tasks
  }

  const task = dag.tasks.find(function (candidate) {
    return candidate.id === requestedTask
  })

  if (!task) {
    throw new Error('Unknown task: ' + requestedTask)
  }

  return [task]
}

function summarizeDryRun (dag, selectedTasks) {
  console.log('Cursor Tauri director dry run')
  console.log('DAG:', dag.name)
  console.log('Repo:', dag.repoUrl)
  console.log('Starting ref:', dag.startingRef)
  console.log('Tasks:')

  selectedTasks.forEach(function (task) {
    console.log('- ' + task.id + ' -> ' + task.branchName + ' [' + (task.model || dag.defaultModel) + ']')
    console.log('  dependsOn: ' + (task.dependsOn.length ? task.dependsOn.join(', ') : 'none'))
    console.log('  validation: ' + task.validation.join(' && '))
  })
}

async function createCloudAgentForTask (apiKey, dag, task, dagPath) {
  const prompt = resolvePrompt(task, dagPath)
  const body = {
    prompt: {
      text: prompt + '\n\nTask id: ' + task.id + '\nValidation commands: ' + task.validation.join(' && ')
    },
    model: {
      id: task.model || dag.defaultModel
    },
    repos: [
      {
        url: dag.repoUrl,
        startingRef: dag.startingRef
      }
    ],
    branchName: task.branchName,
    autoCreatePR: false,
    autoGenerateBranch: false,
    skipReviewerRequest: true
  }

  return cursorRequest(apiKey, 'POST', '/v1/agents', body)
}

async function getRun (apiKey, agentId, runId) {
  return cursorRequest(apiKey, 'GET', '/v1/agents/' + encodeURIComponent(agentId) + '/runs/' + encodeURIComponent(runId))
}

async function waitForRun (apiKey, agentId, runId) {
  while (true) {
    const run = await getRun(apiKey, agentId, runId)
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      return run
    }

    await new Promise(function (resolve) {
      setTimeout(resolve, 10000)
    })
  }
}

async function runDirector () {
  const args = parseArgs(process.argv.slice(2))
  const dag = readJson(args.dagPath)
  const selectedTasks = selectTasks(dag, args.task)

  if (args.dryRun) {
    summarizeDryRun(dag, selectedTasks)
    return
  }

  const env = Object.assign({}, readEnvFile(path.resolve(process.cwd(), '.env')), process.env)
  const apiKey = env.CURSOR_API_KEY

  if (!apiKey) {
    throw new Error('CURSOR_API_KEY is required. Put it in .env or the process environment.')
  }

  const models = await cursorRequest(apiKey, 'GET', '/v1/models')
  const availableModels = new Set((models.items || []).map(function (item) {
    return typeof item === 'string' ? item : item.id
  }))
  const ledger = loadLedger(args.ledgerPath)

  for (const task of selectedTasks) {
    const model = task.model || dag.defaultModel
    if (availableModels.size > 0 && !availableModels.has(model)) {
      throw new Error('Model is not available from /v1/models: ' + model)
    }

    console.log('Starting cloud agent for task ' + task.id + ' on branch ' + task.branchName)
    const created = await createCloudAgentForTask(apiKey, dag, task, args.dagPath)
    const terminalRun = await waitForRun(apiKey, created.agent.id, created.run.id)

    ledger.runs.push({
      taskId: task.id,
      agentId: created.agent.id,
      runId: created.run.id,
      branchName: created.agent.branchName,
      model,
      status: terminalRun.status,
      validation: task.validation,
      createdAt: created.run.createdAt,
      updatedAt: terminalRun.updatedAt,
      url: created.agent.url
    })
    writeLedger(args.ledgerPath, ledger)

    if (terminalRun.status !== 'FINISHED') {
      throw new Error('Task ' + task.id + ' ended with status ' + terminalRun.status)
    }
  }
}

runDirector().catch(function (error) {
  console.error(error.message)
  process.exit(1)
})
