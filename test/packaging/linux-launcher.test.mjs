import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const repository = fileURLToPath(new URL('../..', import.meta.url))
const logs = join(repository, 'test/packaging/results')
const fontName = 'NotoSansCJKsc-VF.ttf'
const fontHash = '990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f'
const sha = (body) => createHash('sha256').update(body).digest('hex')
const options = { skip: process.platform !== 'linux' }

async function fixture(context, run) {
  await mkdir(logs, { recursive: true })
  const root = await mkdtemp(join(logs, 'linux-launcher-test-'))
  try {
    const bundle = join(root, '应用 & <bundle>')
    const resources = join(bundle, 'resources/native-fonts')
    const cwd = join(root, '文件 & <working directory>')
    await mkdir(resources, { recursive: true })
    await mkdir(cwd)
    for (const name of [fontName, 'prepare-fonts.sh']) {
      await copyFile(
        join(repository, 'apps/desktop/build/native-fonts', name),
        join(resources, name),
      )
    }
    await copyFile(
      join(repository, 'apps/desktop/resources/fonts/OFL.txt'),
      join(resources, 'OFL.txt'),
    )
    const launcher = join(bundle, 'manuslip')
    await copyFile(join(repository, 'apps/desktop/build/linux-launcher.sh'), launcher)
    const recorder = join(root, 'recorder.mjs')
    await writeFile(
      recorder,
      `process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),umask:process.umask(),fonts:Object.fromEntries(['FONTCONFIG_FILE','FONTCONFIG_PATH','FONTCONFIG_SYSROOT'].map(key=>[key,process.env[key]??null]))}))\n`,
      { flag: 'wx' },
    )
    await writeFile(
      `${launcher}-bin`,
      '#!/bin/sh\nexec "$MANUSLIP_LAUNCHER_TEST_NODE" "$MANUSLIP_LAUNCHER_TEST_RECORDER" "$@"\n',
      { flag: 'wx', mode: 0o755 },
    )
    const env = { ...process.env }
    for (const key of ['FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'FONTCONFIG_SYSROOT']) delete env[key]
    env.XDG_CACHE_HOME = join(root, '缓存 & <cache>')
    env.MANUSLIP_LAUNCHER_TEST_NODE = process.execPath
    env.MANUSLIP_LAUNCHER_TEST_RECORDER = recorder
    const args = [
      '每一个字 — 🚀.md',
      'literal $(touch unexpected) `echo unsafe` *.md',
      '--',
      'a\nb.md',
    ]
    const launch = async (overrides = {}, path = launcher) => {
      const result = await execute(
        'sh',
        ['-c', 'umask 027\nexec sh "$@"', 'launcher-test', path, ...args],
        {
          cwd,
          env: { ...env, ...overrides },
          timeout: 15_000,
        },
      )
      const recorded = JSON.parse(result.stdout)
      assert.deepEqual(recorded.args, args)
      assert.equal(recorded.cwd, cwd)
      assert.equal(recorded.umask, 0o027)
      return { ...recorded, stderr: result.stderr }
    }
    await run({ root, launcher, resources, env, launch })
  } catch (error) {
    context.diagnostic(`Failed fixture retained at ${root}`)
    throw error
  }
  // Delete only this test's newly created directory, after all assertions pass.
  assert.equal(dirname(root), logs)
  await rm(root, { recursive: true })
}

test(
  'Linux launcher preserves paths, umask and Latin fonts on first, warm and symlink launches',
  options,
  async (context) => {
    await fixture(context, async ({ root, launcher, env, launch }) => {
      const first = await launch()
      assert.equal(first.stderr, '')
      const config = first.fonts.FONTCONFIG_FILE
      const cachedFont = join(dirname(config), fontName)
      assert.equal(sha(await readFile(cachedFont)), fontHash)
      assert.equal(
        await readFile(join(dirname(config), 'OFL.txt'), 'utf8'),
        await readFile(join(repository, 'apps/desktop/resources/fonts/OFL.txt'), 'utf8'),
      )
      const match = (query, configuration) =>
        execFileSync('fc-match', ['-f', '%{file}', query], {
          env: configuration,
          encoding: 'utf8',
          timeout: 10_000,
        })
      const configured = { ...env, FONTCONFIG_FILE: config }
      assert.equal(match(':charset=4e2d', configured), cachedFont)
      for (const family of ['sans-serif', 'serif', 'monospace']) {
        assert.equal(match(family, configured), match(family, env), family)
      }
      const times = await Promise.all([stat(config), stat(cachedFont)])
      assert.deepEqual((await launch()).fonts, first.fonts)
      const link = join(root, '链接 — launcher')
      await symlink(launcher, link)
      assert.deepEqual((await launch({}, link)).fonts, first.fonts)
      const later = await Promise.all([stat(config), stat(cachedFont)])
      assert.deepEqual(
        later.map((file) => file.mtimeMs),
        times.map((file) => file.mtimeMs),
      )
      assert.ok((await readFile(config, 'utf8')).includes('&amp; &lt;cache&gt;'))
      assert.deepEqual(
        (await readdir(dirname(config))).filter((name) => !name.startsWith('.uuid')).sort(),
        [fontName, 'OFL.txt', 'fonts.conf'].sort(),
      )
    })
  },
)

test('Linux launcher repairs a damaged private cached font', options, async (context) => {
  await fixture(context, async ({ launch }) => {
    const first = await launch()
    const cachedFont = join(dirname(first.fonts.FONTCONFIG_FILE), fontName)
    await writeFile(cachedFont, 'damaged cache')
    assert.deepEqual((await launch()).fonts, first.fonts)
    assert.equal(sha(await readFile(cachedFont)), fontHash)
  })
})

test(
  'Linux launcher respects each explicit Fontconfig override without creating a private cache',
  options,
  async (context) => {
    await fixture(context, async ({ env, launch }) => {
      for (const key of ['FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'FONTCONFIG_SYSROOT']) {
        const value = '/explicit host setting & <配置>'
        const result = await launch({ [key]: value })
        assert.equal(result.fonts[key], value)
        for (const other of Object.keys(result.fonts).filter((other) => other !== key)) {
          assert.equal(result.fonts[other], null)
        }
        assert.equal(result.stderr, '')
      }
      await assert.rejects(access(env.XDG_CACHE_HOME), { code: 'ENOENT' })
    })
  },
)

test(
  'Linux launcher still starts when its private cache is unavailable',
  options,
  async (context) => {
    await fixture(context, async ({ env, launch }) => {
      await writeFile(env.XDG_CACHE_HOME, 'A file blocks creation of the cache directory', {
        flag: 'wx',
      })
      const result = await launch()
      assert.equal(result.fonts.FONTCONFIG_FILE, null)
      assert.match(result.stderr, /native font cache unavailable; using system fonts/)
    })
  },
)

test(
  'Linux launcher publishes complete font and configuration files during simultaneous first launches',
  options,
  async (context) => {
    await fixture(context, async ({ launch }) => {
      const results = await Promise.all(Array.from({ length: 4 }, () => launch()))
      for (const result of results) {
        assert.equal(result.stderr, '')
        assert.deepEqual(result.fonts, results[0].fonts)
      }
      const config = results[0].fonts.FONTCONFIG_FILE
      assert.equal(sha(await readFile(join(dirname(config), fontName))), fontHash)
      assert.match(await readFile(config, 'utf8'), /<fontconfig>[\s\S]*<\/fontconfig>/)
      assert.deepEqual(
        (await readdir(dirname(config))).filter((name) => !name.startsWith('.uuid')).sort(),
        [fontName, 'OFL.txt', 'fonts.conf'].sort(),
      )
    })
  },
)
