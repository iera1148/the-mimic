# THE MIMIC

A private horror chat for 2 to 8 people. One of them is not who they say they are.

# What is The Mimic?

The Mimic is a multiplayer chat game. Friends open one website, join a private room with a code, and talk in a channel that already has three extra names in it. One real player is The Mimic. Everyone else is a survivor. The chat looks ordinary. One of the voices is borrowed.

There is no account and no app store. The host creates a room, sends the 6-character code, and starts when at least two people are inside.

# How a round works

The round lasts 6 minutes. Three names are already in the channel: Rae, Sol, and Quinn. They are not players. They talk on their own, and The Mimic can wear their names.

Each person gets a secret role when the host starts.

## Survivors

Survivors win together. They can finish the tasks in the chat, or call a meeting and vote The Mimic out.

A task is a short code to type, a number sequence, or a riddle. In a two-player game there is one survivor, so one finished task wins the round. With more survivors, the team must finish one task for each survivor. The bar in the chat shows the count.

## The Mimic

One player is The Mimic. They have no task. They stay in the chat under their own name, and they can send a line as someone else: another player, or Rae, Sol, or Quinn. Other people see that name on the message. Only The Mimic can see that the line was borrowed.

The Mimic wins if the clock reaches zero, or if the last survivor is voted out.

## The meeting

Anyone still in the round can call an emergency meeting. The room talks, then a vote opens. You cannot vote for yourself. Only a survivor's vote counts, so The Mimic cannot save itself by voting.

- Vote out The Mimic and the survivors win.
- Vote out a real survivor and that person leaves. The clock also jumps forward. If no survivor is left, The Mimic wins.
- Vote for Rae, Sol, or Quinn and that name is cleared from the channel. The clock jumps forward.
- If the vote runs out, The Mimic wins.

# Play

Open [https://the-mimic-lilac.vercel.app](https://the-mimic-lilac.vercel.app).

1. Tap Play and type a name.
2. Create a private room, or join with the code a friend sent.
3. The host starts when two or more people are in the room. Eight is the limit.
4. Read the objective in the chat. Survivors finish the task. The Mimic stays hidden and borrows a voice.
5. Call a meeting if a message does not sound like the person who sent it.

On a phone, open the site in the browser and add it to the home screen. The icon is the two-eyed mark from the game.

## Stack

| Layer | Technology |
| --- | --- |
| App | React, JavaScript, Vite |
| Rooms | A private room file so every phone in the code sees the same chat |
| Hosting | Vercel |

## Run it locally

```bash
npm install
npm run dev
```

Open the address Vite prints. Two browser windows on that address can play one room.
