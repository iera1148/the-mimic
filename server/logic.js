import { readRoom, writeRoom, withLock, isConflict } from './store.js'

const CFG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  ROUND_MS: 6 * 60 * 1000,
  REVEAL_MS: 0,
  DISCUSS_MS: 20000,
  VOTE_MS: 25000,
  MEETING_LOCK_MS: 25000,
  PENALTY_MS: 30000,
  MIN_LEFT_MS: 20000,
  SPEAK_COOLDOWN_MS: 18000,
  AMBIENT_MS: 22000,
  ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
}

const SHADOWS = [
  { id: 'npc-rae', name: 'Rae' },
  { id: 'npc-sol', name: 'Sol' },
  { id: 'npc-quinn', name: 'Quinn' },
]

const AMBIENT = [
  { id: 'npc-rae', text: 'Did someone else just join, or was that the echo?' },
  { id: 'npc-sol', text: 'Count the names before you trust one.' },
  { id: 'npc-quinn', text: 'I already answered. Or someone used my name.' },
  { id: 'npc-rae', text: 'The door locked behind the last real person.' },
  { id: 'npc-sol', text: 'Do the task. The chat is wasting you.' },
  { id: 'npc-quinn', text: 'One of those lines was not mine.' },
]

export async function handleAction(body) {
  const req = body || {}
  try {
    if (req.action === 'createRoom') return await createRoom(req)
    if (req.action === 'joinRoom') return await joinRoom(req)
    if (req.action === 'leaveRoom') return await leaveRoom(req)
    if (req.action === 'pollRoom') return await pollRoom(req)
    if (req.action === 'startGame') return await startGame(req)
    if (req.action === 'sendMessage') return await sendMessage(req)
    if (req.action === 'completeTask') return await completeTask(req)
    if (req.action === 'useMimicAbility') return await useMimicAbility(req)
    if (req.action === 'callEmergencyMeeting') return await callMeeting(req)
    if (req.action === 'submitVote') return await submitVote(req)
    return { ok: false, error: 'Unknown action.' }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Something went wrong.' }
  }
}

async function createRoom(req) {
  const name = cleanName(req.username)
  return withLock('create', async () => {
    const code = await uniqueCode()
    const now = Date.now()
    const player = makePlayer(name, true, now)
    const state = blankState(code, player, now)
    pushMsg(state, systemMsg(name + ' opened the channel.'))
    pushMsg(state, npcMsg(state.npcs[0], 'I saved you a seat. Do not fill every chair.'))
    await writeRoom(code, { version: 1, state })
    return { ok: true, session: sessionOf(player, state), state: publicState(state, player, 0) }
  })
}

async function locked(code, fn) {
  let last
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await withLock(code, fn)
    } catch (err) {
      last = err
      if (!isConflict(err)) throw err
    }
  }
  throw last || new Error('The room is busy. Try again.')
}

async function joinRoom(req) {
  const name = cleanName(req.username)
  const code = cleanCode(req.roomCode)
  return locked(code, async () => {
    const state = await load(code)
    advance(state)
    const existing = findNamed(state, name)
    const now = Date.now()
    if (existing) {
      if (existing.status !== 'left' && now - existing.lastSeen < 45000) {
        throw new Error('That name is already in this room.')
      }
      existing.token = uid() + uid()
      if (existing.status === 'left') existing.status = 'active'
      existing.lastSeen = now
      pushMsg(state, systemMsg(name + ' came back.'))
      await save(code, state)
      return { ok: true, session: sessionOf(existing, state), state: publicState(state, existing, 0) }
    }
    if (state.status !== 'lobby') throw new Error('This game has already started.')
    if (seated(state).length >= CFG.MAX_PLAYERS) throw new Error('This room is full.')
    const player = makePlayer(name, false, now)
    state.players.push(player)
    pushMsg(state, systemMsg(name + ' stepped in.'))
    await save(code, state)
    return { ok: true, session: sessionOf(player, state), state: publicState(state, player, 0) }
  })
}

async function leaveRoom(req) {
  const code = cleanCode(req.roomCode)
  return locked(code, async () => {
    const state = await load(code)
    const player = auth(state, req)
    player.status = 'left'
    if (state.status === 'lobby') {
      const next = seated(state)[0]
      if (next) {
        next.host = true
        state.hostId = next.id
      }
    }
    pushMsg(state, systemMsg(player.name + ' left.'))
    advance(state)
    await save(code, state)
    return { ok: true }
  })
}

async function pollRoom(req) {
  const code = cleanCode(req.roomCode)
  const since = Number(req.sinceSeq) || 0
  return locked(code, async () => {
    const state = await load(code)
    const player = auth(state, req)
    const stamp = stampOf(state)
    const stale = !player.lastSeen || Date.now() - player.lastSeen > 15000
    player.lastSeen = Date.now()
    advance(state)
    if (stale || stampOf(state) !== stamp) await save(code, state)
    return { ok: true, state: publicState(state, player, since) }
  })
}

async function startGame(req) {
  const code = cleanCode(req.roomCode)
  return locked(code, async () => {
    const state = await load(code)
    const player = auth(state, req)
    if (state.status !== 'lobby') throw new Error('The round already started.')
    if (player.id !== state.hostId) throw new Error('Only the host can start.')
    const people = seated(state)
    if (people.length < CFG.MIN_PLAYERS) throw new Error('You need 2 people in the room.')
    assignRoles(state, people)
    const now = Date.now()
    state.status = 'playing'
    state.startedAt = now
    state.roundEndsAt = now + CFG.ROUND_MS
    state.roleRevealUntil = now + CFG.REVEAL_MS
    state.nextAmbientAt = now + CFG.REVEAL_MS + 8000
    state.meetingLockUntil = 0
    pushMsg(state, systemMsg('The channel is live. One voice in here is borrowed.'))
    pushMsg(state, npcMsg(state.npcs[1], 'Lock the door.'))
    await save(code, state)
    return { ok: true, state: publicState(state, player, 0) }
  })
}

async function sendMessage(req) {
  const text = cleanText(req.text)
  return change(req, (state, player) => {
    if (state.status === 'ended') throw new Error('This round is over.')
    if (player.status !== 'active') throw new Error('You are out of this round.')
    if (player.lastMessageAt && Date.now() - player.lastMessageAt < 800) throw new Error('Wait a moment.')
    player.lastMessageAt = Date.now()
    pushMsg(state, { senderId: player.id, name: player.name, text, kind: 'chat', fake: false, at: Date.now() })
  })
}

async function completeTask(req) {
  const taskId = String(req.taskId || '')
  const answer = String(req.answer == null ? '' : req.answer).trim()
  return change(req, (state, player) => {
    if (player.role !== 'survivor') throw new Error('The Mimic has no tasks.')
    if (state.status !== 'playing') throw new Error('Tasks wait until the talking stops.')
    if (Date.now() < state.roleRevealUntil) throw new Error('Read your card first.')
    const task = player.tasks.find((item) => item.id === taskId)
    if (!task || task.status === 'done') throw new Error('That task is already finished.')
    const given = task.type === 'captcha' ? answer : answer.toLowerCase()
    const expected = task.type === 'captcha' ? String(task.answer) : String(task.answer).toLowerCase()
    if (given !== expected) throw new Error('That answer is wrong.')
    task.status = 'done'
    state.tasksDone += 1
    pushMsg(state, systemMsg(player.name + ' finished a task. ' + state.tasksDone + '/' + state.taskGoal))
  })
}

async function useMimicAbility(req) {
  const text = cleanText(req.text)
  const targetId = String(req.targetId || '')
  return change(req, (state, player) => {
    if (player.role !== 'mimic') throw new Error('Only The Mimic can wear another name.')
    if (state.status !== 'playing') throw new Error('You can only borrow a name while the round is live.')
    if (Date.now() < state.roleRevealUntil) throw new Error('Wait until the cards are read.')
    if (player.cooldownUntil && Date.now() < player.cooldownUntil) throw new Error('Your voice needs a moment.')
    const target = speakTarget(state, targetId)
    if (!target || target.id === player.id) throw new Error('Pick someone else.')
    player.cooldownUntil = Date.now() + CFG.SPEAK_COOLDOWN_MS
    const kind = String(target.id).indexOf('npc-') === 0 ? 'npc' : 'chat'
    pushMsg(state, { senderId: player.id, name: target.name, text, kind, fake: true, at: Date.now() })
  })
}

async function callMeeting(req) {
  return change(req, (state, player) => {
    if (player.status !== 'active') throw new Error('You are out of this round.')
    if (state.status !== 'playing') throw new Error('A meeting is already happening.')
    if (Date.now() < state.roleRevealUntil) throw new Error('Read your card first.')
    if (state.meetingLockUntil && Date.now() < state.meetingLockUntil) throw new Error('The channel will not open another meeting yet.')
    if (livingHumans(state) < 2) throw new Error('Not enough people left to meet.')
    state.status = 'meeting'
    state.discussEndsAt = Date.now() + CFG.DISCUSS_MS
    state.voteEndsAt = 0
    state.votes = []
    clearVoted(state)
    pushMsg(state, systemMsg(player.name + ' called a meeting. Talk, then vote.'))
  })
}

async function submitVote(req) {
  const targetId = String(req.targetId || 'skip')
  return change(req, (state, player) => {
    if (state.status !== 'voting') throw new Error('Voting is not open.')
    if (player.status !== 'active') throw new Error('You cannot vote.')
    if (player.voted) throw new Error('You already voted.')
    if (targetId === player.id) throw new Error('You cannot vote for yourself.')
    if (targetId !== 'skip' && !speakTarget(state, targetId)) throw new Error('That person is not in the room.')
    player.voted = true
    state.votes.push({ voterId: player.id, targetId })
  })
}

async function change(req, fn) {
  const code = cleanCode(req.roomCode)
  const since = Number(req.sinceSeq) || 0
  return locked(code, async () => {
    const state = await load(code)
    advance(state)
    const player = auth(state, req)
    fn(state, player)
    advance(state)
    await save(code, state)
    return { ok: true, state: publicState(state, player, since) }
  })
}

async function load(code) {
  const row = await readRoom(code)
  if (!row || !row.state) throw new Error('No room uses that code.')
  row.state._etag = row.etag || ''
  return row.state
}

async function save(code, state) {
  const etag = state._etag || ''
  delete state._etag
  await writeRoom(code, { version: 1, state }, etag)
}

function stampOf(state) {
  return [
    state.status,
    state.nextSeq,
    state.tasksDone,
    state.roundEndsAt,
    state.winner,
    state.discussEndsAt,
    state.voteEndsAt,
    state.nextAmbientAt,
  ].join('|')
}

async function uniqueCode() {
  for (let i = 0; i < 12; i++) {
    const code = makeCode()
    const row = await readRoom(code)
    if (!row) return code
  }
  throw new Error('Could not open a room. Try again.')
}

function makeCode() {
  let code = ''
  for (let i = 0; i < 6; i++) code += CFG.ALPHABET.charAt(Math.floor(Math.random() * CFG.ALPHABET.length))
  return code
}

function blankState(code, host, now) {
  return {
    code,
    hostId: host.id,
    status: 'lobby',
    createdAt: now,
    startedAt: 0,
    roundEndsAt: 0,
    roleRevealUntil: 0,
    discussEndsAt: 0,
    voteEndsAt: 0,
    meetingLockUntil: 0,
    nextAmbientAt: 0,
    taskGoal: 1,
    tasksDone: 0,
    winner: '',
    winReason: '',
    nextSeq: 1,
    players: [host],
    npcs: SHADOWS.map((npc) => ({ id: npc.id, name: npc.name, alive: true })),
    messages: [],
    votes: [],
  }
}

function makePlayer(name, host, now) {
  return {
    id: uid(),
    name,
    token: uid() + uid(),
    host,
    role: '',
    status: 'active',
    tasks: [],
    cooldownUntil: 0,
    voted: false,
    lastSeen: now,
    lastMessageAt: 0,
  }
}

function assignRoles(state, people) {
  const order = shuffle(people)
  order.forEach((person, index) => {
    person.role = index === 0 ? 'mimic' : 'survivor'
    person.tasks = []
    person.voted = false
    person.cooldownUntil = 0
    if (person.role === 'survivor') {
      person.tasks.push(makeTask('captcha'))
      person.tasks.push(makeTask('sequence'))
      person.tasks.push(makeTask('math'))
      person.tasks.push(makeTask('anagram'))
      person.tasks.push(makeTask('riddle'))
    }
  })
  const survivors = order.filter((person) => person.role === 'survivor').length
  state.taskGoal = survivors * 5
  state.tasksDone = 0
  state.winner = ''
  state.winReason = ''
  state.votes = []
}

function makeTask(type) {
  if (type === 'captcha') {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    let answer = ''
    for (let i = 0; i < 6; i++) answer += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    return { id: uid(), type: 'captcha', prompt: 'Type this code: ' + answer, options: [], answer, status: 'open' }
  }
  if (type === 'sequence') return makeSequence()
  if (type === 'math') return makeMath()
  if (type === 'anagram') return makeAnagram()
  return makeRiddle()
}

function makeSequence() {
  const roll = Math.floor(Math.random() * 4)
  let seq
  let correct
  if (roll === 0) {
    const start = 2 + Math.floor(Math.random() * 5)
    seq = [start, start * 2, start * 4, start * 8]
    correct = start * 16
  } else if (roll === 1) {
    const start = 3 + Math.floor(Math.random() * 6)
    seq = [start]
    let step = 2
    for (let i = 0; i < 3; i++) {
      seq.push(seq[seq.length - 1] + step)
      step += 1
    }
    correct = seq[seq.length - 1] + step
  } else if (roll === 2) {
    const a = 2 + Math.floor(Math.random() * 4)
    const b = a + 1 + Math.floor(Math.random() * 3)
    seq = [a, b, a + b, a + 2 * b]
    correct = 2 * a + 3 * b
  } else {
    const n = 2 + Math.floor(Math.random() * 4)
    seq = [n * n, (n + 1) * (n + 1), (n + 2) * (n + 2), (n + 3) * (n + 3)]
    correct = (n + 4) * (n + 4)
  }
  const options = uniqueChoices(correct, [correct - 1, correct + 2, correct - seq[0], correct + seq[1]])
  return { id: uid(), type: 'sequence', prompt: seq.join('   ') + '   ?', options, answer: String(options.indexOf(String(correct))), status: 'open' }
}

function uniqueChoices(correct, extras) {
  const options = [String(correct)]
  const seen = new Set(options)
  extras.forEach((value) => {
    const text = String(value)
    if (value < 0 || seen.has(text)) return
    seen.add(text)
    options.push(text)
  })
  let extra = correct + 3
  while (options.length < 4) {
    const text = String(extra)
    if (!seen.has(text)) {
      seen.add(text)
      options.push(text)
    }
    extra += 1
  }
  return shuffle(options)
}

function makeMath() {
  const a = 6 + Math.floor(Math.random() * 8)
  const b = 4 + Math.floor(Math.random() * 6)
  const c = 3 + Math.floor(Math.random() * 9)
  const answer = String(a * b - c)
  return { id: uid(), type: 'math', prompt: a + ' × ' + b + ' − ' + c, options: [], answer, status: 'open' }
}

function makeAnagram() {
  const words = ['SHADOW', 'WHISPER', 'MIRROR', 'TUNNEL', 'SILENCE', 'STRANGER', 'ECHO', 'LANTERN', 'LOCK', 'CIPHER']
  const answer = words[Math.floor(Math.random() * words.length)]
  const letters = answer.split('')
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = letters[i]
    letters[i] = letters[j]
    letters[j] = swap
  }
  if (letters.join('') === answer && letters.length > 1) {
    const swap = letters[0]
    letters[0] = letters[1]
    letters[1] = swap
  }
  return { id: uid(), type: 'anagram', prompt: 'Unscramble: ' + letters.join(' '), options: [], answer, status: 'open' }
}

function makeRiddle() {
  const bank = [
    { q: 'I have hands but I cannot clap. What am I?', options: ['A clock', 'A mirror', 'A shadow', 'A door'], answer: 'A clock' },
    { q: 'What gets louder the quieter the room becomes?', options: ['A whisper', 'A siren', 'A drum', 'A bell'], answer: 'A whisper' },
    { q: 'The more you take from me, the bigger I grow. What am I?', options: ['A hole', 'A shadow', 'A debt', 'A name'], answer: 'A hole' },
    { q: 'I follow you in daylight and vanish at night. What am I?', options: ['Your shadow', 'A rumour', 'An echo', 'A key'], answer: 'Your shadow' },
    { q: 'What can fill a room without taking up space?', options: ['Light', 'A chair', 'A voice', 'Smoke'], answer: 'Light' },
    { q: 'I have a tongue and no mouth, and I am often heard before I am seen. What am I?', options: ['A bell', 'A shoe', 'A book', 'A map'], answer: 'A bell' },
    { q: 'What word becomes shorter when you add two letters to it?', options: ['Short', 'Small', 'Brief', 'Quiet'], answer: 'Short' },
    { q: 'I copy a face, but I have no face of my own. What am I?', options: ['A mirror', 'A mask', 'A photo', 'A window'], answer: 'A mirror' },
  ]
  const pick = bank[Math.floor(Math.random() * bank.length)]
  const options = shuffle(pick.options.slice())
  return { id: uid(), type: 'riddle', prompt: pick.q, options, answer: String(options.indexOf(pick.answer)), status: 'open' }
}

function advance(state) {
  if (!state || state.status === 'ended' || state.status === 'lobby') return
  const now = Date.now()
  if (state.status === 'playing') {
    if (state.tasksDone >= state.taskGoal) return endGame(state, 'survivors', 'The tasks are finished.')
    if (state.roundEndsAt && now >= state.roundEndsAt) return endGame(state, 'mimic', 'Time ran out.')
    if (now >= state.roleRevealUntil) ambient(state, now)
    return
  }
  if (state.status === 'meeting' && now >= state.discussEndsAt) {
    state.status = 'voting'
    state.voteEndsAt = now + CFG.VOTE_MS
    state.votes = []
    clearVoted(state)
    pushMsg(state, systemMsg('Vote. Only a real survivor vote counts. You cannot choose yourself.'))
    return
  }
  if (state.status === 'voting' && now >= state.voteEndsAt) resolveVotes(state, now)
}

function ambient(state, now) {
  if (!state.nextAmbientAt || now < state.nextAmbientAt) return
  state.nextAmbientAt = now + CFG.AMBIENT_MS
  const pool = AMBIENT.filter((line) => {
    const npc = findNpc(state, line.id)
    return npc && npc.alive
  })
  if (!pool.length) return
  const last = state.messages[state.messages.length - 1]
  const fresh = pool.filter((line) => !last || last.text !== line.text)
  const choices = fresh.length ? fresh : pool
  const line = choices[Math.floor(Math.random() * choices.length)]
  pushMsg(state, npcMsg(findNpc(state, line.id), line.text))
}

function resolveVotes(state, now) {
  const tally = {}
  state.votes.forEach((vote) => {
    const voter = findPlayer(state, vote.voterId)
    if (!voter || voter.role !== 'survivor' || voter.status !== 'active') return
    const target = vote.targetId || 'skip'
    tally[target] = (tally[target] || 0) + 1
  })
  let top = 'skip'
  let topN = 0
  let tie = false
  Object.keys(tally).forEach((key) => {
    if (tally[key] > topN) {
      top = key
      topN = tally[key]
      tie = false
    } else if (tally[key] === topN) tie = true
  })
  state.votes = []
  clearVoted(state)
  state.meetingLockUntil = now + CFG.MEETING_LOCK_MS
  if (tie || top === 'skip' || topN === 0) {
    state.status = 'playing'
    pushMsg(state, systemMsg('Nobody was thrown out.'))
    return
  }
  if (top.startsWith('npc-')) {
    const npc = findNpc(state, top)
    if (npc) npc.alive = false
    state.roundEndsAt = Math.max(now + CFG.MIN_LEFT_MS, state.roundEndsAt - CFG.PENALTY_MS)
    state.status = 'playing'
    pushMsg(state, systemMsg((npc ? npc.name : 'That name') + ' was never in the room. The clock jumps forward.'))
    return
  }
  const person = findPlayer(state, top)
  if (person && person.role === 'mimic') return endGame(state, 'survivors', person.name + ' was The Mimic.')
  if (person && person.role === 'survivor') {
    person.status = 'eliminated'
    state.roundEndsAt = Math.max(now + CFG.MIN_LEFT_MS, state.roundEndsAt - CFG.PENALTY_MS)
    pushMsg(state, systemMsg(person.name + ' was thrown out. They were not The Mimic.'))
    if (livingSurvivors(state) <= 0) return endGame(state, 'mimic', 'No survivors remain.')
  }
  state.status = 'playing'
}

function endGame(state, winner, reason) {
  if (state.status === 'ended') return
  state.status = 'ended'
  state.winner = winner
  state.winReason = reason
  pushMsg(state, systemMsg(reason))
}

function publicState(state, viewer, sinceSeq) {
  const players = state.players
    .filter((person) => !(person.status === 'left' && state.status === 'lobby'))
    .map((person) => ({
      id: person.id,
      name: person.name,
      host: person.id === state.hostId,
      alive: person.status === 'active',
      status: person.status,
      self: person.id === viewer.id,
    }))
  const shadows = state.npcs.map((npc) => ({ id: npc.id, name: npc.name, alive: npc.alive !== false }))
  const messages = state.messages
    .filter((msg) => msg.seq > sinceSeq)
    .map((msg) => {
      const row = { seq: msg.seq, name: msg.name, text: msg.text, kind: msg.kind }
      if (viewer.role === 'mimic' && msg.fake && msg.senderId === viewer.id) row.disguised = true
      return row
    })
  const tasks = viewer.role === 'survivor'
    ? viewer.tasks.map((task) => ({ id: task.id, type: task.type, prompt: task.prompt, options: task.options || [], status: task.status }))
    : []
  const meeting = state.status === 'meeting' || state.status === 'voting'
    ? {
        phase: state.status,
        endsAt: state.status === 'meeting' ? state.discussEndsAt : state.voteEndsAt,
        voted: !!viewer.voted,
        choices: state.status === 'voting' ? voteChoices(state, viewer) : [],
      }
    : null
  const ending = state.status === 'ended'
    ? {
        winner: state.winner,
        reason: state.winReason,
        roles: state.players.filter((person) => person.role).map((person) => ({ name: person.name, role: person.role })),
      }
    : null
  return {
    code: state.code,
    status: state.status,
    minPlayers: CFG.MIN_PLAYERS,
    maxPlayers: CFG.MAX_PLAYERS,
    playerCount: seated(state).length,
    hostId: state.hostId,
    serverNow: Date.now(),
    roundEndsAt: state.roundEndsAt || 0,
    roleRevealUntil: state.roleRevealUntil || 0,
    meetingLockUntil: state.meetingLockUntil || 0,
    taskGoal: state.taskGoal || 0,
    tasksDone: state.tasksDone || 0,
    lastSeq: state.nextSeq - 1,
    players,
    shadows,
    messages,
    meeting,
    ending,
    you: {
      id: viewer.id,
      name: viewer.name,
      host: viewer.id === state.hostId,
      role: viewer.role || '',
      alive: viewer.status === 'active',
      tasks,
      voted: !!viewer.voted,
      speakUntil: viewer.cooldownUntil || 0,
    },
  }
}

function voteChoices(state, viewer) {
  const people = state.players
    .filter((person) => person.id !== viewer.id && person.status === 'active')
    .map((person) => ({ id: person.id, name: person.name }))
  const ghosts = state.npcs.filter((npc) => npc.alive !== false).map((npc) => ({ id: npc.id, name: npc.name }))
  return people.concat(ghosts)
}

function speakTarget(state, id) {
  const person = findPlayer(state, id)
  if (person && person.status === 'active') return person
  const npc = findNpc(state, id)
  if (npc && npc.alive !== false) return npc
  return null
}

function seated(state) {
  return state.players.filter((person) => person.status !== 'left')
}

function livingHumans(state) {
  return state.players.filter((person) => person.status === 'active').length
}

function livingSurvivors(state) {
  return state.players.filter((person) => person.status === 'active' && person.role === 'survivor').length
}

function findPlayer(state, id) {
  return state.players.find((person) => person.id === id) || null
}

function findNpc(state, id) {
  return state.npcs.find((npc) => npc.id === id) || null
}

function findNamed(state, name) {
  const key = name.toLowerCase()
  return state.players.find((person) => person.name.toLowerCase() === key) || null
}

function auth(state, req) {
  const player = findPlayer(state, String(req.playerId || ''))
  if (!player || player.token !== String(req.token || '')) throw new Error('Session expired. Join the room again.')
  return player
}

function clearVoted(state) {
  state.players.forEach((person) => { person.voted = false })
}

function pushMsg(state, msg) {
  msg.seq = state.nextSeq++
  state.messages.push(msg)
  if (state.messages.length > 50) state.messages = state.messages.slice(-40)
}

function systemMsg(text) {
  return { senderId: 'system', name: 'CHANNEL', text, kind: 'system', fake: false, at: Date.now() }
}

function npcMsg(npc, text) {
  return { senderId: npc.id, name: npc.name, text, kind: 'npc', fake: false, at: Date.now() }
}

function sessionOf(player, state) {
  return { roomCode: state.code, playerId: player.id, token: player.token }
}

function cleanName(raw) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 16) throw new Error('Type a name with 2 to 16 letters.')
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) throw new Error('Use letters, numbers, spaces, _ or - only.')
  const key = name.toLowerCase()
  const blocked = { mimic: 1, system: 1, channel: 1, rae: 1, sol: 1, quinn: 1, server: 1, host: 1 }
  if (blocked[key] || key === 'the mimic') throw new Error('That name is already used by the channel.')
  return name
}

function cleanCode(raw) {
  const code = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Enter the 6-character room code.')
  return code
}

function cleanText(raw) {
  let text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('Type a message first.')
  if (text.length > 180) text = text.slice(0, 180)
  if (/^[=+\-@]/.test(text)) text = "'" + text
  return text
}

function shuffle(list) {
  const arr = list.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

function uid() {
  return Math.random().toString(16).slice(2, 14).padEnd(12, '0')
}
