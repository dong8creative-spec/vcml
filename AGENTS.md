# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

`tadakclass` (타닥클래스) is a Korean online-course platform. The web app is a Node.js/Express
server (`server.js`) that serves static pages from `public/` and JSON APIs under `/api/*`
(`routes/*.js`), backed by **Cloud Firestore** via `firebase-admin` (`db/schema.js`).

The `tadaksync-*` and `capcut subtitle` folders are separate **Windows desktop** companion
apps (Python/PyInstaller) and are **not** part of the web dev environment; ignore them unless
explicitly asked to work on them.

### Lint / test / build

- There is **no lint config and no automated test suite** in this repo (no ESLint/Jest/etc.,
  no `test` script). Do not fabricate one; validate changes by running the app.
- There is **no build step** for the web app — it runs `server.js` directly. `npm run dev`
  runs it with `node --watch` (hot reload). The `*:subtitle-tool` npm scripts build the
  separate desktop app and are out of scope for web dev.

### Running the app locally (Firestore emulator)

Production reads real Firebase credentials from a gitignored `firebase-service-account.json`
or `FIREBASE_*` env vars, which are **not** available in the cloud VM. Run against the local
**Firestore emulator** instead. `firebase-tools` is installed by the update script.

`server.js` requires `./db` at import time, and `db/schema.js` calls
`admin.credential.cert({...})` **before** checking the emulator — so it still needs
structurally valid (dummy is fine) `FIREBASE_*` values even when using the emulator.

1. Create `.env` (gitignored) if missing — uses a throwaway RSA key just to satisfy
   `cert()` validation; the emulator ignores it:

   ```bash
   [ -f firebase-service-account.json ] || KEY=$(openssl genrsa 2048 2>/dev/null | sed ':a;N;$!ba;s/\n/\\n/g') && cat > .env <<EOF
   JWT_SECRET=dev-local-jwt-secret-change-me
   PORT=3300
   NODE_ENV=development
   AUTH_BETA_MODE=0
   FIREBASE_PROJECT_ID=demo-tadak
   FIREBASE_CLIENT_EMAIL=dev@demo-tadak.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="$KEY"
   FIREBASE_DATABASE_ID=(default)
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
   EOF
   ```

   Notes: `AUTH_BETA_MODE=0` enables the email signup/login UI (beta mode hides it and shows
   Google/Kakao OAuth only, which need real client secrets). `FIREBASE_DATABASE_ID=(default)`
   points at the emulator's default database (prod uses the named `vcmlmembers` database).

2. Start the Firestore emulator (first run downloads its jar):

   ```bash
   firebase emulators:start --only firestore --project demo-tadak
   ```

3. Start the server (in a separate shell):

   ```bash
   npm run dev
   ```

   On boot it prints `✓ 타닥클래스 서버 실행 중: http://localhost:3300` and
   `✓ Firestore 시드 데이터 완료` — the app **auto-seeds** the emulator with course catalog
   data (`db/course-catalog.js`) on startup, so the DB is usable immediately.

### Gotchas

- Email signup verification: `POST /api/auth/send-code` returns the code as `dev_code` in the
  JSON response (and logs `[인증코드] ... → <code>`), so no real email/SMS is needed for
  local signup/testing.
- Firestore composite indexes (`firestore.indexes.json`) are **not** loaded into the emulator;
  the emulator allows all reads/writes and does not enforce them.
- OAuth (Google/Kakao) and Alimtalk/SMS require real external credentials and will not work in
  the cloud VM — use email signup/login for local flows.
