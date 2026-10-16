# Verification · 2026-10-16

Verified locally with Chrome and Playwright, including a mobile context with touch input. Physical iOS Safari and Android devices have not been tested.

- Layouts: 320×568, 390×844, 768×1024, 844×390, 1440×900. Navigation stays within the viewport; all six navigation controls remain available. Search briefings fit the viewport and scroll on short screens.
- Touch: two-finger pinch changed the displayed zoom from 1.00× to 2.18×; a touch swipe scrolled the briefing by 190 px.
- Rotation: after rotating to 844×390, the drawing buffer matches the canvas at 844×390; the focused photo stays below the game panel.
- Opening animation: the complete opening returns to the 1.00× browsing scale.
- Flows: GRID/ATLAS switching, opening a photo, returning to the wall, DIVE startup and abort, portrait-to-landscape rotation, contribution dialog, and the credits page at 320 px.
- JavaScript syntax: all three scripts passed `node --check`. No page errors occurred in the touch interaction run.
- Assets: all 592 photographs have thumb, preview, and full WebP files; all four sprite atlases and all linked photo IDs exist (1,780 image file checks).
- Deployment: static files, no dependency installation or compilation required. Vercel completion is checked through the deployment command; the deployed URL is not fetched as part of QA.

Screenshots and local automation output are excluded from Git, except for the README cover.

## Game experience iteration

- Completed quick SEARCH and DIVE runs (three targets each) in a 390×844 touch context; validated free photo inspection, incorrect confirmation (+2 s), clue preview, environment hint (+8 s), frozen pause/round-completion timers, explicit next-round controls, and results.
- Completed a five-target daily DIVE challenge at 320×568; validated deterministic targets, one leaderboard record per completed run, PNG score-card download, and sound toggle in the pause menu.
- Tested pausing during a portal, resuming route controls, canceling an exit, and clearing the session on confirmed exit.
- Inspected portrait/landscape gameplay screenshots. Read-only render_game_to_text state agrees with visible controls and progress; no page errors in these runs.
- Ran the develop-web-game skill action client for SEARCH and DIVE using installed Chrome. A local loader bypasses an obsolete skill dependency symlink; no skill files were edited. Supplemental UI flows use the same browser automation CLI.
- Daily scores use the current game rules and a separate local storage bucket from the earlier version.
