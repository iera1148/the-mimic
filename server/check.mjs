import { handleAction } from './logic.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const base = Date.now()
let shift = 0
Date.now = () => base + shift

const bad = await handleAction({ action: 'createRoom', username: 'A' })
assert(!bad.ok, bad.error)

const host = await handleAction({ action: 'createRoom', username: 'Ava' })
assert(host.ok && host.state.playerCount === 1 && host.state.shadows.length === 3, JSON.stringify(host))
assert(JSON.stringify(host.state.players).indexOf('token') === -1, 'token leak')

const early = await handleAction({ action: 'startGame', ...host.session })
assert(!early.ok, early.error)

const guest = await handleAction({ action: 'joinRoom', username: 'Ben', roomCode: host.state.code.toLowerCase() })
assert(guest.ok && guest.state.playerCount === 2, JSON.stringify(guest))

const started = await handleAction({ action: 'startGame', ...host.session })
assert(started.ok && started.state.taskGoal === 1, started.error || started.state.taskGoal)
const guestView = await handleAction({ action: 'pollRoom', ...guest.session })
assert(guestView.state.you.role !== started.state.you.role, 'roles')
assert(JSON.stringify(guestView.state.players).indexOf('"role"') === -1, 'role leak')

const survivor = started.state.you.role === 'survivor' ? host.session : guest.session
const survivorView = started.state.you.role === 'survivor' ? started.state : guestView.state
shift = 7000
const task = survivorView.you.tasks[0]
const code = task.prompt.split(': ')[1]
const done = await handleAction({ action: 'completeTask', ...survivor, taskId: task.id, answer: code })
assert(done.state.ending && done.state.ending.winner === 'survivors', JSON.stringify(done))

async function pair(tag) {
  shift = 0
  const a = await handleAction({ action: 'createRoom', username: tag + 'a' })
  const b = await handleAction({ action: 'joinRoom', username: tag + 'b', roomCode: a.state.code })
  const began = await handleAction({ action: 'startGame', ...a.session })
  const other = await handleAction({ action: 'pollRoom', ...b.session })
  const surv = began.state.you.role === 'survivor' ? { session: a.session, view: began.state } : { session: b.session, view: other.state }
  const mim = began.state.you.role === 'mimic' ? { session: a.session, view: began.state } : { session: b.session, view: other.state }
  return { surv, mim }
}

const voice = await pair('Z')
shift = 8000
const said = await handleAction({ action: 'useMimicAbility', ...voice.mim.session, targetId: 'npc-rae', text: 'Trust Sol.' })
assert(said.ok && said.state.messages.some((msg) => msg.disguised && msg.name === 'Rae'), said.error || 'disguise')

const caught = await pair('X')
shift = 8000
const called = await handleAction({ action: 'callEmergencyMeeting', ...caught.surv.session })
assert(called.ok, called.error)
shift = 8000 + 21000
const voting = await handleAction({ action: 'pollRoom', ...caught.surv.session })
assert(voting.state.status === 'voting', voting.state.status)
const eject = await handleAction({ action: 'submitVote', ...caught.surv.session, targetId: caught.mim.view.you.id })
assert(eject.ok, eject.error)
shift = 8000 + 21000 + 26000
const after = await handleAction({ action: 'pollRoom', ...caught.surv.session })
assert(after.state.ending && after.state.ending.winner === 'survivors', JSON.stringify(after.state.ending))

const clock = await pair('W')
shift = 7 * 60 * 1000
const timed = await handleAction({ action: 'pollRoom', ...clock.surv.session })
assert(timed.state.ending && timed.state.ending.winner === 'mimic', JSON.stringify(timed.state.ending))

console.log('mimic rules ok')
