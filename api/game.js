import { handleAction } from '../server/logic.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' })
    return
  }
  const result = await handleAction(req.body || {})
  res.status(200).json(result)
}
