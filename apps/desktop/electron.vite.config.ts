import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [
      {
        name: 'application-window-icon',
        buildStart() {
          this.addWatchFile(resolve('build/icons/512x512.png'))
        },
        writeBundle() {
          copyFileSync(resolve('build/icons/512x512.png'), resolve('out/main/icon.png'))
        },
      },
    ],
    build: {
      externalizeDeps: { exclude: ['@manuslip/renderer', '@manuslip/core', '@manuslip/translate'] },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'clipboard.worker': resolve('src/main/clipboard/conversion.worker.ts'),
          'export.worker': resolve('src/main/exports/render.worker.ts'),
          'translation-cache.worker': resolve('src/main/translation/cache.worker.ts'),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].mjs',
          // Preserve initialization order across shared main and worker inspection chunks.
          strictExecutionOrder: true,
        },
      },
    },
  },
  preload: {
    plugins: [
      {
        name: 'preload-markdown-boundary',
        generateBundle(_options, bundle) {
          const parsers = Object.values(bundle).flatMap((chunk) =>
            chunk.type === 'chunk'
              ? Object.entries(chunk.modules)
                  .filter(
                    ([id, module]) =>
                      module.renderedLength > 0 &&
                      /\/(?:packages\/core\/src\/(?:parse|markdown-compile)\.ts|node_modules\/(?:mdast-util-from-markdown\/|micromark(?:-|\/)|unified\/))/.test(
                        id.replaceAll('\\', '/'),
                      ),
                  )
                  .map(([id]) => id)
              : [],
          )
          if (parsers.length)
            this.error(
              `Preload must not initialize Markdown parsers (${parsers.length} modules): ${parsers.slice(0, 3).join(', ')}`,
            )
        },
      },
      {
        name: 'standalone-diagram-preload',
        buildStart() {
          this.addWatchFile(resolve('src/preload/diagram.cjs'))
          this.addWatchFile(resolve('src/preload/print.cjs'))
          this.addWatchFile(resolve('src/preload/plugin.cjs'))
        },
        writeBundle() {
          copyFileSync(resolve('src/preload/diagram.cjs'), resolve('out/preload/diagram.cjs'))
          copyFileSync(resolve('src/preload/print.cjs'), resolve('out/preload/print.cjs'))
          copyFileSync(resolve('src/preload/plugin.cjs'), resolve('out/preload/plugin.cjs'))
        },
      },
    ],
    build: {
      externalizeDeps: { exclude: ['@manuslip/renderer', '@manuslip/translate', '@manuslip/core'] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    publicDir: resolve('resources'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          diagram: resolve('src/renderer/diagram/index.html'),
          print: resolve('src/renderer/print/index.html'),
        },
      },
    },
    worker: {
      format: 'es',
    },
    plugins: [react()],
    // The semantic parser's entity decoder has a DOM-only browser export. Its worker
    // export uses a pure entity table and is also safe in the renderer.
    resolve: {
      conditions: ['worker', 'module', 'browser', 'development|production'],
      alias: { '@': resolve('src/renderer') },
    },
  },
})
