import { useEffect, useRef, useState } from 'react'

const KEY = 'the-mimic-web-v1'
const WHISPERS = [
  'Not everyone who walks in was invited.',
  'Three names were already here.',
  'Count the chairs. Then count the voices.',
  'Two is enough. Trust is not.',
  'The code is the only key. Share it carefully.',
]

async function call(action, payload) {
  const response = await fetch('/api/game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  return response.json()
}

function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function App() {
  const [screen, setScreen] = useState('home')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [session, setSession] = useState(() => loadSession())
  const [room, setRoom] = useState(null)
  const [lines, setLines] = useState([])
  const [lobbyDraft, setLobbyDraft] = useState('')
  const [draft, setDraft] = useState('')
  const [taskAnswer, setTaskAnswer] = useState('')
  const [mimicText, setMimicText] = useState('')
  const [mimicTarget, setMimicTarget] = useState('')
  const [clock, setClock] = useState('--:--')
  const [whisper, setWhisper] = useState(WHISPERS[0])
  const [howOpen, setHowOpen] = useState(false)
  const [pane, setPane] = useState('chat')
  const lastSeq = useRef(0)
  const offset = useRef(0)
  const polling = useRef(false)
  const sessionRef = useRef(session)
  sessionRef.current = session

  function remember(next) {
    setSession(next)
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  }

  function takeState(next, fresh) {
    if (!next) return
    if (next.serverNow) offset.current = next.serverNow - Date.now()
    setLines((current) => {
      const incoming = next.messages || []
      if (fresh) return incoming
      const seen = new Set(current.map((msg) => msg.seq))
      return current.concat(incoming.filter((msg) => !seen.has(msg.seq)))
    })
    lastSeq.current = fresh ? (next.lastSeq || 0) : Math.max(lastSeq.current, next.lastSeq || 0)
    setRoom(next)
    setScreen(next.status === 'lobby' ? 'lobby' : 'play')
  }

  useEffect(() => {
    if (!session) return undefined
    let stop = false
    async function poll() {
      if (polling.current) return
      const current = sessionRef.current
      if (!current) return
      polling.current = true
      try {
        const result = await call('pollRoom', { ...current, sinceSeq: lastSeq.current })
        if (stop) return
        if (!result.ok) {
          if (result.error && result.error.indexOf('Session') !== -1) {
            remember(null)
            setRoom(null)
            setScreen('home')
            setNote(result.error)
          }
          return
        }
        takeState(result.state, false)
      } finally {
        polling.current = false
      }
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [session])

  useEffect(() => {
    const timer = setInterval(() => {
      setWhisper(WHISPERS[Math.floor(Date.now() / 6000) % WHISPERS.length])
      if (!room) return
      const now = Date.now() + offset.current
      const ends = room.status === 'playing' ? room.roundEndsAt : room.meeting && room.meeting.endsAt
      if (!ends) {
        setClock(room.status === 'ended' ? '00:00' : '--:--')
        return
      }
      const left = Math.max(0, Math.ceil((ends - now) / 1000))
      const minutes = Math.floor(left / 60)
      const seconds = left % 60
      setClock(`${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`)
    }, 500)
    return () => clearInterval(timer)
  }, [room])

  async function createRoom() {
    if (name.trim().length < 2) {
      setNote('Type a name with at least 2 letters, then click Create room.')
      return
    }
    setBusy('create')
    setNote('Opening a room...')
    const result = await call('createRoom', { username: name.trim() })
    setBusy('')
    if (!result.ok) {
      setNote(result.error || 'Could not open the room.')
      return
    }
    setNote('')
    remember(result.session)
    takeState(result.state, true)
  }

  async function joinRoom() {
    if (name.trim().length < 2) {
      setNote('Type a name with at least 2 letters.')
      return
    }
    setBusy('join')
    setNote('Joining...')
    const result = await call('joinRoom', { username: name.trim(), roomCode: code })
    setBusy('')
    if (!result.ok) {
      setNote(result.error || 'Could not join.')
      return
    }
    setNote('')
    remember(result.session)
    takeState(result.state, true)
  }

  async function act(action, extra, box) {
    const result = await call(action, { ...session, sinceSeq: lastSeq.current, ...extra })
    if (!result.ok) setNote(result.error || 'That did not work.')
    else {
      if (box) setNote('')
      if (result.state) takeState(result.state, action === 'startGame')
    }
  }

  async function leave() {
    const current = session
    lastSeq.current = 0
    remember(null)
    setRoom(null)
    setLines([])
    setScreen('home')
    if (current) call('leaveRoom', current)
  }

  async function copyCode() {
    if (!room) return
    try {
      await navigator.clipboard.writeText(room.code)
      setNote('Copied ' + room.code)
    } catch {
      setNote(room.code)
    }
  }

  const you = room?.you || {}
  const openTask = (you.tasks || []).find((task) => task.status !== 'done')
  const need = room ? Math.max(0, (room.minPlayers || 2) - (room.playerCount || 0)) : 0
  const canStart = !!(you.host && room && need === 0)

  return (
    <>
    <div className="atmosphere" aria-hidden="true">
      <div className="vignette" />
      <div className="scanlines" />
      <div className="noise" />
    </div>
    <div id="app">
      {screen === 'home' && (
        <section className="screen active">
          <header className="topbar">
            <span className="live-pip">Channel 00</span>
            <span>private frequency</span>
          </header>
          <div className="hero">
            <div>
              <p className="eyebrow">A multiplayer horror chat</p>
              <div className="brand">
                <img src="/favicon.svg" alt="" width="72" height="72" />
                <h1 className="wordmark">THE MIMIC</h1>
              </div>
              <p className="tagline">Someone in this chat isn't who they say they are.<span className="caret" /></p>
              <div className="hero-actions">
                <button className="btn btn-primary" type="button" onClick={() => { setNote(''); setScreen('gate') }}>Play game</button>
                <button className="btn btn-ghost" type="button" onClick={() => setHowOpen(true)}>How to play</button>
              </div>
              <p className="hero-foot">2–8 players · one private room · one borrowed voice</p>
            </div>
            <div className="demo-window" aria-hidden="true">
              <div className="demo-chrome"><span /><span /><span /><strong># the-group</strong></div>
              <div className="demo-log">
                <DemoLine name="Ava" color="#7C9CFF" text="Did everyone make it in?" />
                <DemoLine name="Rae" color="#C084FC" text="I saved you a seat. Do not fill every chair." />
                <DemoLine name="Sol" color="#39FF88" text="Count the names before you trust one." />
                <DemoLine name="Ava" color="#7C9CFF" text="That did not sound like Rae." />
              </div>
              <div className="demo-input">Message the channel</div>
            </div>
          </div>
          <section className="about">
            <p className="eyebrow">About the game</p>
            <h2>A group chat with one extra person who is not on the list.</h2>
            <div className="about-grid">
              <article>
                <h3>Survivors</h3>
                <p>Finish a short task, read the room, and find the voice that does not belong.</p>
              </article>
              <article>
                <h3>The Mimic</h3>
                <p>One secret role. If it is you, borrow another name and keep them talking until the clock dies.</p>
              </article>
              <article>
                <h3>The vote</h3>
                <p>Call a meeting. Vote once. Choose an empty name and the clock jumps forward.</p>
              </article>
            </div>
          </section>
        </section>
      )}

      {screen === 'gate' && (
        <section className="screen screen-join active">
          <button className="text-btn" type="button" onClick={() => setScreen('home')}>Back</button>
          <div className="join-card">
            <p className="eyebrow">Open a channel</p>
            <h2>Who is speaking?</h2>
            <label htmlFor="player-name">Username</label>
            <input id="player-name" maxLength={16} placeholder="Ava" value={name} onChange={(event) => setName(event.target.value)} />
            <button className="btn btn-primary btn-block" type="button" disabled={busy === 'create'} onClick={createRoom}>{busy === 'create' ? 'Opening...' : 'Create private room'}</button>
            <div className="or-line"><span>or join with a code</span></div>
            <label htmlFor="room-code">Room code</label>
            <input id="room-code" maxLength={6} placeholder="K7MQ2D" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} />
            <button className="btn btn-ghost btn-block" type="button" disabled={busy === 'join'} onClick={joinRoom}>{busy === 'join' ? 'Joining...' : 'Join room'}</button>
            <p className="form-error">{note}</p>
          </div>
        </section>
      )}

      {screen === 'lobby' && room && (
        <section className="screen active">
          <div className="lobby-shell">
            <aside className="lobby-side">
              <p className="eyebrow">Private room</p>
              <h2>{room.code}</h2>
              <button className="btn btn-ghost" type="button" onClick={copyCode}>Copy code</button>
              <p className="muted">{room.playerCount} / {room.maxPlayers} in the channel</p>
              <p className="share-note">Send the code to the people you trust. One of them may not deserve it.</p>
              <p className="sys-line">{whisper}</p>
              <p className="form-error">{note}</p>
            </aside>
            <div className="lobby-main">
              <header className="section-head">
                <h3>In the channel</h3>
                <span>{need ? `Need ${room.minPlayers} to start` : 'Ready to lock the door'}</span>
              </header>
              <div className="roster">
                {room.players.map((person) => <Person key={person.id} person={person} />)}
                {room.shadows.map((shadow) => (
                  <div className="person" key={shadow.id}>
                    <span className="avatar" style={{ background: '#A855F7' }}>{shadow.name[0]}<i className="dot online" /></span>
                    <span className="pname">{shadow.name}</span>
                    <span className="chip ghost">not a player</span>
                  </div>
                ))}
              </div>
              <div className="lobby-actions">
                <button className="btn btn-primary" type="button" disabled={!canStart} onClick={() => act('startGame')}>
                  {!you.host ? 'Waiting for the host' : need ? `Need ${room.minPlayers} players` : 'Start game'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => { const text = lobbyDraft; setLobbyDraft(''); if (text.trim()) act('sendMessage', { text }) }}>Send</button>
                <button className="btn btn-ghost btn-danger" type="button" onClick={leave}>Leave room</button>
              </div>
              <label htmlFor="lobby-draft">Say something before it starts</label>
              <input id="lobby-draft" maxLength={180} value={lobbyDraft} onChange={(event) => setLobbyDraft(event.target.value)} placeholder="Message the channel" />
            </div>
          </div>
        </section>
      )}

      {screen === 'play' && room && (
        <section className={`screen screen-game active show-${pane}`}>
          <div className="mobile-tabs">
            <button type="button" className={pane === 'people' ? 'on' : ''} onClick={() => setPane('people')}>People</button>
            <button type="button" className={pane === 'chat' ? 'on' : ''} onClick={() => setPane('chat')}>Chat</button>
            <button type="button" className={pane === 'obj' ? 'on' : ''} onClick={() => setPane('obj')}>Objectives</button>
          </div>
          <div className="game-shell">
            <aside className="pane side side-left">
              <div className="brand-mini">THE MIMIC</div>
              <div className="code-row">
                <div>
                  <p className="eyebrow">Room</p>
                  <strong>{room.code}</strong>
                </div>
                <button className="btn btn-ghost btn-tiny" type="button" onClick={copyCode}>Copy</button>
              </div>
              <p className="muted">{room.players.filter((person) => person.alive).length} online</p>
              <div className="roster">
                {room.players.map((person) => <Person key={person.id} person={person} />)}
                {room.shadows.map((shadow) => (
                  <div className={`person ${shadow.alive ? '' : 'dead'}`} key={shadow.id}>
                    <span className="avatar" style={{ background: '#A855F7' }}>{shadow.name[0]}<i className={shadow.alive ? 'dot online' : 'dot off'} /></span>
                    <span className="pname">{shadow.name}</span>
                    <span className="chip ghost">{shadow.alive ? 'in channel' : 'cleared'}</span>
                  </div>
                ))}
              </div>
            </aside>
            <main className="pane chat-col">
              <header className="chat-head">
                <div>
                  <p className="channel"># corrupted-chat</p>
                  <p className="muted">A private channel. Not everyone here is listed honestly.</p>
                </div>
                <span className="sync-dot" />
              </header>
              {(room.status === 'meeting' || room.status === 'voting') && (
                <div className="meeting-banner">
                  <div>
                    <p className="eyebrow">Emergency meeting</p>
                    <p>{room.status === 'voting' ? 'Vote now. You cannot choose yourself.' : 'Talk, then the vote opens.'}</p>
                  </div>
                  <strong>{clock}</strong>
                </div>
              )}
              <div className="messages">
                {lines.map((msg) => <Message key={msg.seq} msg={msg} />)}
              </div>
              {you.role === 'survivor' && room.status === 'playing' && openTask && (
                <Objective task={openTask} answer={taskAnswer} setAnswer={setTaskAnswer} onSubmit={(value) => act('completeTask', { taskId: openTask.id, answer: value })} />
              )}
              {you.role === 'mimic' && room.status === 'playing' && (
                <div className="objective">
                  <p className="eyebrow">Your objective</p>
                  <h3>Stay hidden until the clock ends.</h3>
                  <p className="muted">Send a line as someone else. The survivors win if they finish their task or vote you out.</p>
                </div>
              )}
              <form className="composer" onSubmit={(event) => { event.preventDefault(); const text = draft; setDraft(''); if (text.trim()) act('sendMessage', { text }) }}>
                <input maxLength={180} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message #corrupted-chat" aria-label="Message" />
                <button className="btn btn-primary" type="submit">Send</button>
              </form>
              <p className="form-error" style={{ padding: '0 14px 10px' }}>{note}</p>
            </main>
            <aside className="pane side side-right">
              <p className="eyebrow">Objectives</p>
              <div className="stat-block">
                <span className="timer">{room.status === 'playing' || room.meeting ? clock : '--:--'}</span>
                <span className="status-pill">{room.status}</span>
              </div>
              <div className="meter">
                <div className="meter-label"><span>Team tasks</span><span>{room.tasksDone}/{room.taskGoal}</span></div>
                <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, Math.round((room.tasksDone / (room.taskGoal || 1)) * 100))}%` }} /></div>
              </div>
              <p className="panel-note">
                {you.role === 'mimic' && 'You are The Mimic. Borrow another name. Survive until the clock ends.'}
                {you.role === 'survivor' && 'You are a survivor. Finish the task, or vote out The Mimic.'}
                {!you.role && 'The host is starting the round.'}
              </p>
              {you.role === 'survivor' && room.status === 'playing' && openTask && (
                <p className="panel-note">Your task is in the chat. Finish it and the survivors win.</p>
              )}
              {you.role === 'mimic' && room.status === 'playing' && (
                <div id="ability-form">
                  <label>Use the face of</label>
                  <select value={mimicTarget} onChange={(event) => setMimicTarget(event.target.value)}>
                    <option value="">Choose a voice</option>
                    {room.players.filter((person) => person.alive && !person.self).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                    {room.shadows.filter((shadow) => shadow.alive).map((shadow) => <option key={shadow.id} value={shadow.id}>{shadow.name}</option>)}
                  </select>
                  <label>Message they will appear to send</label>
                  <input maxLength={180} placeholder="Say something they might say" value={mimicText} onChange={(event) => setMimicText(event.target.value)} />
                  <button className="btn btn-primary btn-block" type="button" onClick={() => { const text = mimicText; setMimicText(''); act('useMimicAbility', { targetId: mimicTarget, text }) }}>Use it</button>
                </div>
              )}
              {room.meeting?.phase === 'voting' && (
                <div className="vote-list">
                  <p className="panel-note">{room.meeting.voted ? 'Vote locked in.' : 'Throw someone out.'}</p>
                  {!room.meeting.voted && room.meeting.choices.map((choice) => (
                    <button className="vote-btn" type="button" key={choice.id} onClick={() => act('submitVote', { targetId: choice.id })}>{choice.name}</button>
                  ))}
                  {!room.meeting.voted && <button className="btn btn-ghost btn-block" type="button" onClick={() => act('submitVote', { targetId: 'skip' })}>Skip vote</button>}
                </div>
              )}
              <button className="btn btn-danger btn-block" id="btn-emergency" type="button" disabled={room.status !== 'playing' || !you.alive} onClick={() => act('callEmergencyMeeting')}>Emergency meeting</button>
              <button className="btn btn-ghost btn-block" type="button" onClick={leave}>Leave</button>
            </aside>
          </div>
          {room.ending && (
            <div className="modal">
              <div className={room.ending.winner === 'mimic' ? 'end-card bad' : 'end-card'}>
                <p className="eyebrow">Round over</p>
                <h2>{room.ending.winner === 'survivors' ? 'The channel goes quiet' : 'The Mimic stays'}</h2>
                <p>{room.ending.reason}</p>
                {room.ending.roles.map((role) => <p key={role.name}>{role.name} — {role.role === 'mimic' ? 'The Mimic' : 'Survivor'}</p>)}
                <div className="row-btns">
                  <button className="btn btn-primary" type="button" onClick={leave}>Return to menu</button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
    {howOpen && (
      <div className="modal">
        <div className="modal-card">
          <p className="eyebrow">How to play</p>
          <h2>Trust is the mechanic.</h2>
          <ol className="how-list">
            <li>Create a room and share the 6-character code. Two people can start. Only the host can lock the door.</li>
            <li>You receive one secret role. Survivors do a short task. One player is The Mimic.</li>
            <li>Three extra names are already in the channel. They are not players. The Mimic can speak as one of them.</li>
            <li>Call a meeting and vote. Only a survivor vote counts. You cannot vote for yourself.</li>
            <li>Vote The Mimic and the survivors win. Vote an empty name and the clock jumps. If time runs out, The Mimic wins.</li>
          </ol>
          <button className="btn btn-primary" type="button" onClick={() => setHowOpen(false)}>Close</button>
        </div>
      </div>
    )}
    </>
  )
}

function Objective({ task, answer, setAnswer, onSubmit }) {
  const code = task.type === 'captcha' ? String(task.prompt.split(': ').pop() || '') : ''
  return (
    <div className="objective">
      <p className="eyebrow">Your objective</p>
      <h3>{task.type === 'captcha' ? 'Type this code' : task.type === 'sequence' ? 'What number comes next?' : 'Pick the right answer'}</h3>
      {task.type === 'captcha' ? (
        <div className="captcha-row">{code.split('').map((letter, index) => <span key={index}>{letter}</span>)}</div>
      ) : (
        <p className="objective-prompt">{task.prompt}</p>
      )}
      <p className="muted">Finish this and the survivors win.</p>
      {task.options.length > 0 ? task.options.map((label, index) => (
        <button className="choice-btn" type="button" key={`${task.id}-${index}`} onClick={() => onSubmit(String(index))}>{label}</button>
      )) : (
        <>
          <input maxLength={12} placeholder="Type the code" value={answer} onChange={(event) => setAnswer(event.target.value)} />
          <button className="btn btn-primary btn-block" type="button" onClick={() => onSubmit(answer)}>Submit task</button>
        </>
      )}
    </div>
  )
}

function hue(name) {
  let n = 0
  for (let i = 0; i < name.length; i++) n = (n * 33 + name.charCodeAt(i)) % 360
  return `hsl(${n} 70% 62%)`
}

function Person({ person }) {
  return (
    <div className={person.alive ? 'person' : 'person dead'}>
      <span className="avatar" style={{ background: hue(person.name) }}>
        {person.name[0]}
        <i className={person.alive ? 'dot online' : 'dot off'} />
      </span>
      <span className="pname">{person.name}{person.self ? ' · you' : ''}</span>
      {person.host ? <span className="chip host">host</span> : <span className="chip">{person.alive ? 'here' : person.status}</span>}
    </div>
  )
}

function DemoLine({ name, color, text }) {
  return (
    <div className="demo-msg">
      <span className="demo-av" style={{ background: color }}>{name[0]}</span>
      <div><strong style={{ color }}>{name}</strong><p>{text}</p></div>
    </div>
  )
}

function Message({ msg }) {
  if (msg.kind === 'system') {
    return <div className="msg msg-system"><p>{msg.name}: {msg.text}</p></div>
  }
  return (
    <div className="msg">
      <span className="avatar" style={{ background: msg.kind === 'npc' ? '#A855F7' : hue(msg.name) }}>{msg.name[0]}</span>
      <div>
        <div className="msg-name"><strong>{msg.name}</strong></div>
        <p>{msg.text}</p>
        {msg.disguised ? <em className="alias-tag">your voice</em> : null}
      </div>
    </div>
  )
}
