import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { handleAction } from './server/logic.js'

function mimicApi() {
  return {
    name: 'mimic-api',
    configureServer(server) {
      server.middlewares.use('/api/game', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', async () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8')
            const body = raw ? JSON.parse(raw) : {}
            const result = await handleAction(body)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          } catch (err) {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: err.message || 'Something went wrong.' }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), mimicApi()],
  server: { port: 5174, strictPort: true },
})
