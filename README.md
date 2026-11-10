# Smart Classroom (LG webOS + Mobile Controller)

## Features
- TV presentation screen (`/tv.html`) with bilingual questions and standard remote keyboard controls.
- Mobile/desktop dashboard, question bank, CSV import/export, timer and performance view.
- Socket.IO live sync between TV and controller.
- Supabase-backed permanent question bank and saved room presentation state.
- Telegram admin bot for classroom controls and question-bank management.

## Run locally
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in the environment variables.
4. Apply `supabase/schema.sql` to the Supabase project's SQL Editor.
5. Run `npm start` and open `http://localhost:3000`.

## Render environment variables
Set these in Render Dashboard → your Web Service → Environment:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never put this in frontend code or GitHub)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_ID` (your numeric Telegram user ID)
- `PUBLIC_BASE_URL` (Render HTTPS URL, no trailing slash)
- `TELEGRAM_WEBHOOK_SECRET` (random secret, 32+ characters)
- `CLASSROOM_ROOM` (optional, defaults to CLASS10)
- `CLASSROOM_ADMIN_KEY` (optional API key for protected dashboard database writes)

## Telegram commands
- `/start` or `/help` — help
- `/status` — room and current question
- `/next`, `/prev` — navigate
- `/answer`, `/hide` — reveal/hide answer
- `/list` — list first 30 questions with IDs
- `/add Class 8 | Science | Chapter | Hindi question | English question | A | B | C | D | Answer(A-D) | Explanation`
- `/edit QUESTION_ID | Class 8 | Science | Chapter | Hindi question | English question | A | B | C | D | Answer(A-D) | Explanation`
- `/delete QUESTION_ID`

The bot is restricted to the Telegram user ID configured in `TELEGRAM_ADMIN_ID`. The webhook endpoint checks Telegram's secret-token header. The Supabase service key is used only on the Node server.

## Database
Apply `supabase/schema.sql` once in Supabase SQL Editor. RLS is enabled and browser roles have no table privileges; only the backend service role can access the tables.

## Deployment notes
Use a Render **Web Service** with build command `npm install` and start command `npm start`. Configure all environment variables before deploying. Render Free services can sleep after inactivity; Telegram webhook updates may be delayed while the service wakes.

## LG TV
Open `/tv.html` on the TV and the dashboard on the phone. Use the same room code. If the TV's remote keyboard navigation is limited, use the mobile Controller.

## Existing browser data
The existing V3 question bank is stored in each browser's localStorage. This integration does not automatically upload those private browser records. Export them as CSV and import them into the database through the dashboard or use the bot's `/add` command after setup.
