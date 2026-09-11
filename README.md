# Notes

A simple, modern notes app. Write in a clean page, pick your font, font size,
and paper size, and everything syncs automatically across your devices
through Firebase. No build step — plain HTML/CSS/JS, ready to host on GitHub
Pages and install on an iPad as a PWA.

## 1. Finish the Firebase setup (one-time, ~5 minutes)

Your Firebase config is already wired into `firebase-config.js`, pointing at
the `notepad-eb5f5` project. Two things still need to be turned on in the
[Firebase console](https://console.firebase.google.com/project/notepad-eb5f5):

**Enable email/password sign-in**
1. Go to **Build → Authentication → Sign-in method**.
2. Enable **Email/Password**.

**Create the Firestore database**
1. Go to **Build → Firestore Database → Create database**.
2. Choose **Production mode** and any nearby region.
3. Once created, go to the **Rules** tab and paste in the contents of
   `firestore.rules` from this project, then **Publish**. This makes sure
   each account can only read and write its own notes.

That's it — no other config, API keys, or environment variables needed.

## 2. Put it on GitHub

1. Create a new GitHub repository and push everything in this folder to it
   (keep the folder structure as-is; `icons/` needs to stay next to
   `index.html`).
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, pick your main branch
   and the `/ (root)` folder, then **Save**.
4. GitHub will give you a URL like
   `https://your-username.github.io/your-repo-name/`. It can take a minute
   to go live.

*If you deploy from a subfolder or use a custom domain, no changes are
needed — every path in this project is relative.*

## 3. Install it on your iPad

1. Open the GitHub Pages URL in **Safari** on the iPad (must be Safari, not
   Chrome, for the install option to appear).
2. Tap the **Share** icon, then **Add to Home Screen**.
3. Tap **Add**. A "Notes" icon appears on the home screen and opens full-screen,
   like a native app, with offline support.

Create an account the first time you open it (any email + password — this
account only exists inside your own Firebase project). Sign in with the same
account on any other device to see the same notes, kept in sync.

## What's inside

- `index.html` — app structure (sign-in screen + notes screen)
- `style.css` — all styling
- `app.js` — app logic: auth, Firestore sync, the editor and toolbar
- `firebase-config.js` — your Firebase project connection
- `manifest.json` / `service-worker.js` — what makes it installable and
  usable offline
- `icons/` — home screen icons
- `firestore.rules` — the security rules to paste into the Firebase console

## Notes on how it works

- **Sync**: each note is a document in Firestore under
  `users/{your-user-id}/notes/{note-id}`. Edits autosave about 700ms after
  you stop typing, and every signed-in device gets updates in real time.
- **Offline**: notes are cached on-device, so you can keep writing without a
  connection — changes sync automatically once you're back online.
- **Fonts & paper size**: each note remembers its own font, font size, and
  paper size (A4, US Letter, Legal, or a borderless "Continuous" layout).
  Your latest choice becomes the default for the next new note.
- Formatting (bold, italic, underline, bulleted lists) uses simple, native
  browser text editing — intentionally lightweight rather than a full
  word-processor, so it stays fast and doesn't feel like Word.
