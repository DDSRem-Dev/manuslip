import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** A separate, explicit release profile. Ordinary builds never inherit its options. */
export function createReleasePlan(
  base,
  { platform, arch, signed = false, updates = false, env = {} },
) {
  if (
    !['win32', 'darwin', 'linux'].includes(platform) ||
    !['x64', 'arm64'].includes(arch) ||
    (platform !== 'darwin' && arch !== 'x64')
  )
    throw new Error('Use a supported native release host: Windows/Linux x64 or macOS x64/arm64')
  if (signed && platform === 'linux')
    throw new Error('--signed configures Windows/macOS code signing; Linux artifacts use checksums')
  const config = structuredClone(base)
  config.publish = null
  config.forceCodeSigning = signed
  config.win.signExecutable = signed
  config.mac.identity = null
  config.mac.notarize = false
  const requiredEnvironment = []
  if (signed && platform === 'win32') {
    requiredEnvironment.push('WIN_CSC_LINK or CSC_LINK', 'WIN_CSC_KEY_PASSWORD or CSC_KEY_PASSWORD')
  } else if (signed && platform === 'darwin') {
    delete config.mac.identity
    config.mac.notarize = true
    config.mac.hardenedRuntime = true
    config.dmg = { ...config.dmg, sign: true }
    requiredEnvironment.push('CSC_LINK', 'CSC_KEY_PASSWORD', 'Apple notarization credentials')
  }
  if (updates) {
    const value = env.MANUSLIP_UPDATE_URL
    let url
    try {
      if (typeof value !== 'string' || value.length > 2048 || /[\s\p{Cc}]/u.test(value))
        throw new Error()
      url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new Error()
    } catch {
      throw new Error(
        'MANUSLIP_UPDATE_URL must be an HTTPS directory URL without credentials, query or fragment',
      )
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/'
    const channel = env.MANUSLIP_UPDATE_CHANNEL || 'latest'
    if (!['latest', 'beta', 'alpha'].includes(channel))
      throw new Error('MANUSLIP_UPDATE_CHANNEL must be latest, beta or alpha')
    config.publish = { provider: 'generic', url: url.href, channel, publishAutoUpdate: true }
    config.detectUpdateChannel = false
    config.generateUpdatesFilesForAllChannels = false
    if (platform === 'darwin') config.mac.target = ['dmg', 'zip']
  }
  return {
    platform,
    arch,
    signed,
    updates,
    publish: 'never',
    updatesRuntimeIncluded: false,
    requiredEnvironment,
    config,
  }
}

export function validateSigningEnvironment(plan, env) {
  if (!plan.signed) return
  const present = (name) => typeof env[name] === 'string' && env[name].length > 0
  const password = (name) => typeof env[name] === 'string'
  if (plan.platform === 'win32') {
    if (
      !(present('WIN_CSC_LINK') || present('CSC_LINK')) ||
      !(password('WIN_CSC_KEY_PASSWORD') || password('CSC_KEY_PASSWORD'))
    )
      throw new Error(
        'Signed Windows packaging requires a certificate and password in the documented environment variables',
      )
  } else {
    const notarization = [
      ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
      ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
      ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'],
    ].some((names) => names.every(present))
    if (!present('CSC_LINK') || !password('CSC_KEY_PASSWORD') || !notarization)
      throw new Error(
        'Signed macOS packaging requires a certificate/password and one complete Apple notarization credential set',
      )
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (
    new Set(args).size !== args.length ||
    args.some((arg) => !['--signed', '--updates', '--plan'].includes(arg))
  )
    throw new Error('Usage: npm run package:release -- [--signed] [--updates] [--plan]')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const desktop = join(root, 'apps/desktop')
  const metadata = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'))
  const plan = createReleasePlan(metadata.build, {
    platform: process.platform,
    arch: process.arch,
    signed: args.includes('--signed'),
    updates: args.includes('--updates'),
    env: process.env,
  })
  plan.config.directories.output = '<new directory under test/packaging/result/releases>/artifacts'
  if (args.includes('--plan')) {
    console.log(JSON.stringify(plan, null, 2))
    return
  }
  validateSigningEnvironment(plan, process.env)
  await access(join(desktop, 'out/main/index.mjs')).catch(() => {
    throw new Error('Build current application assets with npm run build:app before packaging')
  })
  const releases = join(root, 'test/packaging/result/releases')
  await mkdir(releases, { recursive: true })
  const directory = await mkdtemp(join(releases, 'candidate-'))
  const output = join(directory, 'artifacts')
  plan.config.directories.output = output
  const config = join(directory, 'builder.json')
  await writeFile(config, `${JSON.stringify(plan.config, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await writeFile(join(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  const platform = { win32: '--win', darwin: '--mac', linux: '--linux' }[process.platform]
  const builderArgs = [
    join(root, 'node_modules/electron-builder/cli.js'),
    platform,
    `--${process.arch}`,
    '--config',
    config,
    '--publish',
    'never',
  ]
  const startedAt = new Date().toISOString()
  const exitCode = await new Promise((resolveBuild, reject) => {
    const child = spawn(process.execPath, builderArgs, {
      cwd: desktop,
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: plan.signed ? 'true' : 'false' },
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code) => resolveBuild(code ?? 1))
  })
  const artifacts = []
  if (exitCode === 0) {
    for (const entry of await readdir(output, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.uuid') || entry.name.startsWith('builder-'))
        continue
      const body = await readFile(join(output, entry.name))
      artifacts.push({
        name: entry.name,
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      })
    }
    artifacts.sort((a, b) => a.name.localeCompare(b.name))
    await writeFile(
      join(output, 'SHA256SUMS'),
      artifacts.map((row) => `${row.sha256}  ${row.name}\n`).join(''),
      { flag: 'wx' },
    )
  }
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    version: metadata.version,
    directory,
    output,
    platform: plan.platform,
    arch: plan.arch,
    signedRequested: plan.signed,
    updateMetadataRequested: plan.updates,
    publish: 'never',
    artifacts,
  }
  const reportPath = join(directory, 'report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  console.log(`Release package evidence: ${reportPath}`)
  process.exitCode = exitCode
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Release packaging failed')
    process.exitCode = 1
  })
}
