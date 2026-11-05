import { execFile } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export function releaseVersion(tag, manifests) {
  const match =
    /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)$/.exec(
      tag,
    )
  if (!match || match[2]?.split('.').some((part) => /^0\d+$/.test(part)))
    throw new Error('Release tag must be v followed by a valid semantic version')
  const version = match[1]
  if (!manifests.length || manifests.some((manifest) => manifest.version !== version))
    throw new Error('Release tag must match the root, desktop and all workspace versions')
  return { version, prerelease: Boolean(match[2]) }
}

export async function validateReleaseTag(tag, root = process.cwd()) {
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF !== `refs/tags/${tag}`)
    throw new Error(
      'Run the release workflow from the selected version tag so provenance binds to that tag',
    )
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  const manifests = await Promise.all(
    Object.keys(lock.packages)
      .filter((key) => key === '' || /^(?:apps|packages)\/[^/]+$/.test(key))
      .map(async (key) => JSON.parse(await readFile(resolve(root, key, 'package.json'), 'utf8'))),
  )
  const version = releaseVersion(tag, manifests)
  const git = async (...args) => (await execute('git', args, { cwd: root })).stdout.trim()
  const sha = await git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_SHA !== sha)
    throw new Error('Release tag moved after this workflow started')
  if ((await git('rev-parse', 'HEAD')) !== sha)
    throw new Error('Checkout does not match the release tag')
  await git('merge-base', '--is-ancestor', sha, 'origin/main')
  return { tag, sha, ...version }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  validateReleaseTag(process.env.MANUSLIP_RELEASE_TAG || '').then(
    async (release) => {
      if (process.env.GITHUB_OUTPUT)
        await appendFile(
          process.env.GITHUB_OUTPUT,
          Object.entries(release)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(''),
        )
      console.log(JSON.stringify(release, null, 2))
    },
    (error) => {
      console.error(error.message)
      process.exitCode = 1
    },
  )
}
