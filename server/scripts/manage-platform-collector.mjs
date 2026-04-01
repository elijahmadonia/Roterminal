import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const COLLECTOR_SCRIPT_PATH = path.join(REPO_ROOT, 'server', 'scripts', 'push-platform-history.mjs')
const DEFAULT_LABEL = 'com.roterminal.platform-collector'
const DEFAULT_URL = 'https://www.roterminal.co'
const DEFAULT_RANGE = '24h'
const DEFAULT_SOURCE = 'mac_platform_sync'
const DEFAULT_BATCH_SIZE = 500
const DEFAULT_RETRY_COUNT = 12
const DEFAULT_RETRY_DELAY_MS = 5_000
const DEFAULT_INTERVAL_SECONDS = 300

function parseArgs(argv) {
  const options = {
    uninstall: false,
    dryRun: false,
    label: process.env.ROTERMINAL_PLATFORM_COLLECTOR_LABEL || DEFAULT_LABEL,
    url: process.env.ROTERMINAL_IMPORT_URL || DEFAULT_URL,
    range: DEFAULT_RANGE,
    source: DEFAULT_SOURCE,
    batchSize: DEFAULT_BATCH_SIZE,
    retryCount: DEFAULT_RETRY_COUNT,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--uninstall') {
      options.uninstall = true
      continue
    }

    if (token === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (token === '--label' && argv[index + 1]) {
      options.label = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--url' && argv[index + 1]) {
      options.url = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--range' && argv[index + 1]) {
      options.range = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--source' && argv[index + 1]) {
      options.source = argv[index + 1]
      index += 1
      continue
    }

    if (token === '--batch-size' && argv[index + 1]) {
      options.batchSize = Math.max(1, Number(argv[index + 1]) || DEFAULT_BATCH_SIZE)
      index += 1
      continue
    }

    if (token === '--retry-count' && argv[index + 1]) {
      options.retryCount = Math.max(0, Number(argv[index + 1]) || DEFAULT_RETRY_COUNT)
      index += 1
      continue
    }

    if (token === '--retry-delay-ms' && argv[index + 1]) {
      options.retryDelayMs = Math.max(0, Number(argv[index + 1]) || DEFAULT_RETRY_DELAY_MS)
      index += 1
      continue
    }

    if (token === '--interval-seconds' && argv[index + 1]) {
      options.intervalSeconds = Math.max(60, Number(argv[index + 1]) || DEFAULT_INTERVAL_SECONDS)
      index += 1
    }
  }

  return options
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildPlist(options) {
  const logDirectory = path.join(os.homedir(), 'Library', 'Logs')
  const stdoutPath = path.join(logDirectory, `${options.label}.out.log`)
  const stderrPath = path.join(logDirectory, `${options.label}.err.log`)
  const programArguments = [
    process.execPath,
    '--env-file-if-exists=.env',
    COLLECTOR_SCRIPT_PATH,
    '--url',
    options.url,
    '--range',
    options.range,
    '--batch-size',
    String(options.batchSize),
    '--retry-count',
    String(options.retryCount),
    '--retry-delay-ms',
    String(options.retryDelayMs),
    '--source',
    options.source,
  ]
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(REPO_ROOT)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${options.intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`
}

function getLaunchctlDomain() {
  const uid = process.getuid?.()

  if (!Number.isInteger(uid)) {
    throw new Error('launchctl requires a user session. Run this from your macOS login shell.')
  }

  return `gui/${uid}`
}

async function bootoutIfPresent(domain, plistPath) {
  try {
    await execFileAsync('launchctl', ['bootout', domain, plistPath])
  } catch {
    // Ignore missing or already-unloaded agents.
  }
}

async function installCollector(options) {
  if (!options.dryRun && !process.env.ROTERMINAL_IMPORT_TOKEN) {
    throw new Error(
      'Missing ROTERMINAL_IMPORT_TOKEN in your environment or .env. Add the shared import token locally before installing the collector.',
    )
  }

  const launchAgentsDirectory = path.join(os.homedir(), 'Library', 'LaunchAgents')
  const plistPath = path.join(launchAgentsDirectory, `${options.label}.plist`)
  const plistContents = buildPlist(options)

  if (options.dryRun) {
    console.log(plistContents)
    return
  }

  await mkdir(launchAgentsDirectory, { recursive: true })
  await mkdir(path.join(os.homedir(), 'Library', 'Logs'), { recursive: true })
  await writeFile(plistPath, plistContents, 'utf8')

  const domain = getLaunchctlDomain()
  await bootoutIfPresent(domain, plistPath)
  await execFileAsync('launchctl', ['bootstrap', domain, plistPath])
  await execFileAsync('launchctl', ['kickstart', '-k', `${domain}/${options.label}`])

  console.log(`Installed ${options.label} at ${plistPath}`)
}

async function uninstallCollector(options) {
  const launchAgentsDirectory = path.join(os.homedir(), 'Library', 'LaunchAgents')
  const plistPath = path.join(launchAgentsDirectory, `${options.label}.plist`)

  if (options.dryRun) {
    console.log(`Would remove ${plistPath}`)
    return
  }

  const domain = getLaunchctlDomain()
  await bootoutIfPresent(domain, plistPath)
  await rm(plistPath, { force: true })

  console.log(`Removed ${options.label} from ${plistPath}`)
}

const options = parseArgs(process.argv.slice(2))

if (options.uninstall) {
  await uninstallCollector(options)
} else {
  await installCollector(options)
}
