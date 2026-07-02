import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Motion Lab dev API (Motion Probe 0.7) — dev server only, never in a build.
//   POST /__lab/save             { file: "rel/path.png", dataUrl: "data:image/png;base64,..." }
//                                -> writes .probe_tmp/captures/<file>, returns { ok, path }
//   GET  /__lab/ls               -> { motions, poses, hands, vrma } (ids/urls, from public/ +
//                                   the shared assets/motion-pack — see below)
//   GET  /__lab/vrma-pack/<file> -> streams ../assets/motion-pack/vrma/<file>. The pack's terms
//                                   forbid redistributing the files, so they are SERVED from
//                                   their original folder instead of copied into public/
//                                   (public/ is bundled verbatim into dist/).
// Used by src/lib/lab/motionLab.ts (window.__motionLab) and the App motion selector.
function motionLabApi(): Plugin {
  return {
    name: 'motion-lab-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const capturesRoot = path.resolve(root, '.probe_tmp/captures')
      // Pose Composer 0.8: authored pose/hand assets are written back into the
      // source tree, so the write is whitelisted to these two dirs only.
      const posesRoot = path.resolve(root, 'public/poses')
      const handsRoot = path.resolve(posesRoot, 'hands')
      const poseBackupRoot = path.resolve(root, '.probe_tmp/pose_backups')

      const listIds = (dir: string, suffix: string): string[] => {
        try {
          return fs
            .readdirSync(path.resolve(root, dir))
            .filter((f) => f.endsWith(suffix))
            .map((f) => f.slice(0, -suffix.length))
            .sort()
        } catch {
          return []
        }
      }

      const vrmaPackDir = path.resolve(root, '../assets/motion-pack/vrma')

      server.middlewares.use('/__lab/ls', (_req, res) => {
        // .vrma sources: files the app can fetch directly from public/motions/,
        // plus the (non-redistributable) MotionPack served via /__lab/vrma-pack/.
        const vrma = [
          ...listIds('public/motions', '.vrma').map((id) => ({ id, url: `/motions/${id}.vrma` })),
          ...((): { id: string; url: string }[] => {
            try {
              return fs
                .readdirSync(vrmaPackDir)
                .filter((f) => f.endsWith('.vrma'))
                .sort()
                .map((f) => ({ id: f.slice(0, -'.vrma'.length), url: `/__lab/vrma-pack/${f}` }))
            } catch {
              return []
            }
          })(),
        ]
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            motions: listIds('public/motions/dsl', '.motion.json'),
            poses: listIds('public/poses', '.pose.json'),
            hands: listIds('public/poses/hands', '.hand.json'),
            vrma,
          }),
        )
      })

      server.middlewares.use('/__lab/vrma-pack', (req, res) => {
        const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        if (!/^[\w-]+\.vrma$/.test(name)) {
          res.statusCode = 400
          return res.end(JSON.stringify({ ok: false, error: `bad vrma name "${name}"` }))
        }
        const file = path.resolve(vrmaPackDir, name)
        if (!file.startsWith(vrmaPackDir) || !fs.existsSync(file)) {
          res.statusCode = 404
          return res.end(JSON.stringify({ ok: false, error: `${name} not found in assets/motion-pack/vrma` }))
        }
        res.setHeader('content-type', 'model/gltf-binary')
        fs.createReadStream(file).pipe(res)
      })

      server.middlewares.use('/__lab/save', (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' })
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            const { file, dataUrl } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (typeof file !== 'string' || !/^[\w\-./ぁ-ヿ一-鿿]+\.(png|json)$/.test(file) || file.includes('..')) {
              return reply(400, { ok: false, error: `bad file path "${file}" — relative path ending in .png/.json, no ".."` })
            }
            const target = path.resolve(capturesRoot, file)
            if (!target.startsWith(capturesRoot)) {
              return reply(400, { ok: false, error: 'path escapes the captures directory' })
            }
            let buf: Buffer
            if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
              buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
            } else if (typeof dataUrl === 'string' && file.endsWith('.json')) {
              buf = Buffer.from(dataUrl, 'utf8')
            } else {
              return reply(400, { ok: false, error: 'dataUrl must be a "data:image/png;base64," URL (or raw text for .json files)' })
            }
            fs.mkdirSync(path.dirname(target), { recursive: true })
            fs.writeFileSync(target, buf)
            reply(200, { ok: true, path: target, bytes: buf.length })
          } catch (e) {
            reply(500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        })
      })

      // POST /__lab/pose/save  { file: "<id>.pose.json" | "hands/<id>.hand.json", json: "..." }
      //   -> writes into public/poses/ (or public/poses/hands/), backing up any
      //      existing file into .probe_tmp/pose_backups/ first. dev-only (apply:'serve').
      server.middlewares.use('/__lab/pose/save', (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' })
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            const { file, json } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            // <id>.pose.json at the root, or hands/<id>.hand.json — no traversal.
            if (typeof file !== 'string' || file.includes('..') ||
                !/^(hands\/)?[\w-]+\.(pose|hand)\.json$/.test(file)) {
              return reply(400, { ok: false, error: `bad file "${file}" — "<id>.pose.json" or "hands/<id>.hand.json"` })
            }
            if (typeof json !== 'string') {
              return reply(400, { ok: false, error: 'json must be a string (the file contents)' })
            }
            const target = path.resolve(posesRoot, file)
            const dir = path.dirname(target)
            if (dir !== posesRoot && dir !== handsRoot) {
              return reply(400, { ok: false, error: 'writes are limited to public/poses/ and public/poses/hands/' })
            }
            // Back up an existing file (never overwrite in place without a copy).
            let backup: string | null = null
            if (fs.existsSync(target)) {
              fs.mkdirSync(poseBackupRoot, { recursive: true })
              backup = path.resolve(poseBackupRoot, `${path.basename(file)}.${Date.now()}.bak`)
              fs.copyFileSync(target, backup)
            }
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(target, json, 'utf8')
            reply(200, { ok: true, path: target, backup })
          } catch (e) {
            reply(500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), motionLabApi()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['..'],
    },
  },
})
