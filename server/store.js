const memory = new Map()
const tails = new Map()

export function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve()
  const run = prev.then(() => fn(), () => fn())
  tails.set(key, run.then(() => {}, () => {}))
  return run
}

function useMemory() {
  return !process.env.BLOB_READ_WRITE_TOKEN
}

function conflict() {
  const err = new Error('The room changed. Try again.')
  err.code = 'conflict'
  return err
}

export function isConflict(err) {
  if (!err) return false
  if (err.code === 'conflict') return true
  const status = err.status || err.statusCode
  const message = String(err.message || '')
  return status === 412 || /precondition|if-match|etag/i.test(message)
}

export async function readRoom(code) {
  if (useMemory()) {
    const row = memory.get(code)
    return row ? { state: row.state, version: row.version, etag: row.etag } : null
  }
  const { get } = await import('@vercel/blob')
  try {
    const result = await get(`rooms/${code}.json`, { access: 'private', useCache: false })
    if (!result || result.statusCode === 304 || !result.stream) return null
    const text = await new Response(result.stream).text()
    const row = JSON.parse(text)
    row.etag = (result.blob && result.blob.etag) || result.etag || ''
    return row
  } catch (err) {
    const name = err && (err.name || '')
    const message = err && (err.message || '')
    if (name === 'BlobNotFoundError' || /not found|404/i.test(message)) return null
    throw err
  }
}

export async function writeRoom(code, row, etag) {
  if (useMemory()) {
    const current = memory.get(code)
    if (etag && (!current || current.etag !== etag)) throw conflict()
    const nextEtag = String((current ? Number(current.etag) : 0) + 1)
    memory.set(code, { state: row.state, version: row.version, etag: nextEtag })
    return
  }
  const { put } = await import('@vercel/blob')
  const options = {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: !etag,
    contentType: 'application/json',
    cacheControlMaxAge: 1,
  }
  if (etag) options.ifMatch = etag
  try {
    await put(`rooms/${code}.json`, JSON.stringify({ state: row.state, version: row.version }), options)
  } catch (err) {
    if (isConflict(err)) throw conflict()
    throw err
  }
}
