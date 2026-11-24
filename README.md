# THE MIMIC

A private horror chat for 2 to 8 people. One of them is The Mimic. Open the website, create a room, and send the code. No Google login.

The Apps Script link fails for other people because Google asks them to sign in, and a school account can block anyone outside that school. This copy is a normal website, the same kind of link as UsSpace.

## Run it here

```bash
npm install
npm run dev
```

Open the local address Vite prints. Two browser windows on that address can play one room.

## Put it on Vercel

From this folder, while logged in to Vercel:

```bash
npx vercel link --yes --project the-mimic
npx vercel blob create-store the-mimic-rooms --access private --yes --region sin1
npx vercel deploy --prod --yes
```

The Blob store is what lets two phones share the same room. Share the `https://....vercel.app` link, not a `script.google.com` link.
