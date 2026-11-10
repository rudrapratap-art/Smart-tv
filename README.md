# Smart Classroom (LG webOS + Mobile Controller)

## Features
- TV presentation screen (`/tv.html`) with large bilingual questions.
- Mobile/desktop dashboard and question bank (`/`).
- Remote keyboard support: Left = previous, Right = next, Enter/Space = reveal answer.
- Auto-play timer (15/30/45/60/90 sec).
- Add/edit/delete questions; stored in browser localStorage.
- Socket.IO live sync between TV and controller when both use the same hosted server and room code.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder run `npm install`
3. Run `npm start`
4. Open `http://localhost:3000` on your computer.
5. For TV/mobile on the same Wi-Fi, use the computer's LAN IP, e.g. `http://192.168.1.5:3000`.
6. On TV open `/tv.html`; on mobile open `/` then Controller. Use the same room code (default `CLASS10`).

## Hosting
Deploy this Node.js project to a host that supports persistent WebSocket connections (for example Railway). Set start command to `npm start`. Open the hosted URL on TV and mobile.

## LG TV notes
Model 32LR570B6LA is listed by LG India with webOS 23 and a full web browser. The TV browser should be tested with the hosted URL. Keep the page simple and avoid heavy animations. If keyboard navigation on the included standard remote is limited, use LG ThinQ smartphone remote or the mobile Controller page.

## Important MVP notes
- Question data currently saves in the browser that created it. For shared editing across different devices, add a database in the next version.
- TV and mobile live sync uses a shared room and Socket.IO.
- The TV display tab should remain open while teaching.


## Version 2.0 upgrade
- CSV import/export for question bank.
- Chapter filter.
- Performance dashboard with student-wise correct/incorrect counts.
- Teacher can record a student's answer using the Controller page.
- Random question order is enabled when selected in Settings.
- CSV header format: `class,subject,chapter,hi,en,A,B,C,D,answer,explain`
- `answer` uses zero-based option index: 0=A, 1=B, 2=C, 3=D.
- Scores and questions are saved in the current browser's localStorage. For a shared permanent school-wide database, connect a database in a later deployment stage.


## Version 3.0 final improvements
- Bulk select questions, select all filtered results, and delete selected questions with confirmation.
- Dynamic Class and Subject filters based on imported question data.
- Search now checks Hindi/English question text, chapter, subject, and available answer options.
- Clear Filters button resets all filters and current selection.
- Edit Question supports imported custom class/subject values and legacy `options` / `A-D` data shapes.
- CSV export supports both current and legacy option fields.
- CSV import accepts answer index `0–3` or letter `A/B/C/D`, validates invalid answer values, and checks all four option cells.
- TV renderer supports legacy option fields and safely escapes option text.
- Empty Question Bank state is handled more safely.
