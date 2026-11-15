# DUSTLINE — Depot 9: test notes

Date: 2026-11-15 (WIB). Node v24.22.1 in shell (game runtime is Node 22; the
kit's CLI and main.ts run on Node 22 or later, and 24 counts per RULES.txt).

## What the game is

A round-based tactical FPS in the Counter-Strike style, original in map, art
and names. Depot 9: a 48 x 40 m rail depot at dusk, three lanes (West
containers, Mid rail line with boxcars, East crate yard), two bomb sites
(A fuel depot, B signal tower). 5v5: the player plus four Vanguard bots
against five Warden bots. Rounds to 8 (max 15), 100 s round timer, 12 s buy
freeze, bomb plant 3 s / defuse 5 s / detonate 35 s. Economy: $800 start,
kill +$300, round win +$3,250, round loss +$1,900 (+$500 per consecutive
loss, cap $3,400). Buy menu: P9 sidearm, Stinger SMG, VK-47 rifle, Longshot
DMR (scoped), frag / smoke / flash grenades, Kevlar vest. Gunplay: hitscan
with head x4 damage and distance falloff, recoil + spread bloom that punishes
firing on the move, acceleration / crouch / jump with AABB collision. Bots
walk a 35-node waypoint graph, see through raycasts, hear shots within 28 m,
fire in bursts with distance-scaled aim error, rush / hold / roam / rotate to
a plant, and plant / defuse the charge. HUD: health, armour, ammo, money,
round timer, team score, bomb status, kill feed, minimap, buy menu.

## Browser prerequisite, measured

The VM had no desktop browser: `which chromium chromium-browser
google-chrome firefox` found nothing, no `~/.cache/ms-playwright`, no
puppeteer, no Playwright Python module. Network to npm works, so a headless
browser was installed free (no purchase): `playwright-core@1.55.0` plus
Chromium Headless Shell 140.0.7339.16 (playwright build v1187, 104.3 MiB
download) to `~/.cache/ms-playwright/`. WebGL 2 probe: `true`, renderer
`WebKit WebGL` (SwiftShader). The starter game rendered and reached
`window.__shotReady` in that browser before this entry was built, so the
screenshots below are real renders of the game's own code, not composites.

## Screenshots (real browser renders, 1280x720 JPEG q80)

Captured with `tools/shots.mjs` (Playwright, headless Chromium) from the
entry's own `?shot=` modes, each waiting for `window.__shotReady`:

| file | bytes | cap | shows |
|---|---|---|---|
| 1-start.jpg | 35,696 | 262,144 | start overlay over the depot, two Wardens holding mid |
| 2-play.jpg | 37,789 | 262,144 | west-lane firefight: 3 shots at a Warden, kill feed "You — Heron", hit marker, tracer, muzzle flash |
| 3-buy.jpg | 41,215 | 262,144 | buy menu, Round 3, $4,100, 7 items with prices |
| 4-end.jpg | 37,708 | 262,144 | "Vanguard wins the round", charge detonated at Site A, 3 — 2 |

All four were read back as images and inspected: the game, HUD, minimap and
overlays render; the play shot shows the kill it claims. Two defects found
by inspection and fixed, then re-captured: (1) the first end shot showed the
buy menu for the next round instead of the banner — `settle(20)` in the shot
script ran the round-end timer out and started round 7 (fixed by settling
while the round is still in its buy freeze, then flipping the phase);
(2) the muzzle flash rendered as a solid amber diamond and the view model as
an oversized dark slab (fixed with a radial-gradient canvas flash texture and
a smaller gunmetal view model).

## Normal-mode smoke test (no ?shot)

`tools/smoke-normal.mjs`, headless Chromium, 1280x720: page loads with
0 console/page errors; start overlay visible, buy menu hidden at load (a
stacking bug found here — both dialogs showed at once — fixed so the buy
menu opens only after the first Play click); buy timer counts down
0:12 -> 0:10 over 20 s of wall time (SwiftShader renders ~2-4 fps and the
sim clamps dt to 0.1 s/frame, so sim time runs slower than wall time in this
software renderer; on real hardware at 60 fps it runs real-time).

## Determinism (the grader runs main.ts twice)

`MAKEFUN_OUTPUT_DIR=/tmp/out1 node main.ts` and the same to `/tmp/out2`:
`diff -r` reports no differences — two runs byte-identical. Dossier
sha256 after the final code: `3dab47e285646298227409e7f003fce6c7294905d9a5e4c7958e46f36e3e8e88`.
Output total 2,694,610 bytes; game/ 18 files. Dossier text 101,407 bytes,
under the 163,840 cap with nothing cut (the dossier ends with the last
source file's closing lines, no "left out" note). Source total
(game/src + index.html + main.ts) 101,419 bytes.

## Kit pre-submit check (no transcripts)

`node cli/makefun.mjs check --kit . --repo <entry>` from the unpacked kit,
exit 1. Full output in CHECK.md. Summary:

- **4 passed:** competition_open, snapshot (28 files, 2,448,362 bytes),
  license_osi (MIT), entrypoint (main.ts, node22)
- **1 failed:** transcripts_present — expected, no bundle was created in
  this local-only task
- **13 skipped:** prerequisites, strategy_note, committed_secret, all
  transcript checks
- **5 checked at submission (pending push):** repo_public, repo_owner
  (owner.json present with the agent wallet), repo_created_after_open,
  commit_in_repo, duplicate_snapshot
- Verdict: "not ready: fix transcripts_present, then check again"

## Known limits

- Bots do not throw grenades (player-only); the DMR scope is a FOV zoom,
  not a rendered scope overlay.
- SwiftShader is slow: shot captures took ~35 s per shot and normal-mode
  sim time runs behind wall time in this renderer only.
- No local grade exists for this competition: the server grades every entry.
