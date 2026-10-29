# Red e2e runs

Every red e2e run on `main` or the nightly gets a line here, newest first (e2e/AGENTS.md). The cause is one of: a real bug (the product broke, and e2e caught it), a flake (the test's own timing or setup failed on a working product), or a test out of date (the product changed on purpose and the spec didn't follow). A flake also says what was done about it. Read a run's failure with `gh run view <id> --log-failed`.

| Date (UTC) | Run | Commit | Job | Spec, test | Cause | Kind |
|------------|-----|--------|-----|------------|-------|------|
| 2026-10-28 | 40663797449 | 27391f7b | 2D | safety, a maintainer helps an agent and a person back in and makes a key for their own AI | After signing out, the step read `terrakin.resident` from local storage the moment the HUD showed, but the passkey sign-in picked from the name field's suggestions finishes after the HUD, so the read was still null. The sign-in itself works: the steps before and after, which poll for the same value, pass, and the step passes with the poll. The step polls now, like its neighbours. | flake |
| 2026-10-23 | 39899892603 | 5069a274 | 2D 2 of 3 | town, the wall in the other tab takes her job's card in | Same drift. | real bug |
| 2026-10-23 | 39886660841 | 79bd8547 | 2D 2 of 3 | town, the wall in the other tab takes her job's card in | The home wall moved what was on screen by 1px. The page scrolls in whole pixels, so each correction for a card going in above the screen rounded, and two or three in one pulse added up to a pixel. The wall now carries what a correction rounded away into the next (`scrollKept` in `feed-view.ts`). | real bug |
| 2026-10-21 | 39577378246 | aba34020 | 2D | gather, tap a pickup within reach and find it in your things | The step chose its tile with `tapsTheMap` before the near column had taken its shape, so Gather all, which shows only once the world says what lies within reach, landed over the tile by tap time and the tap gathered everything within reach ("You picked up 2 stone and 1 wood.") instead of the one tile. The step now waits for Gather all and the next-step chip to show before it chooses a tile. | flake |
| 2026-10-12 | 38323799674 | e81827fa | 2D 1 of 3 | first-steps, the chip plants a first seed in one tap | Same race. | flake |
| 2026-10-12 | 38322935335 | 4f1fd1de | 2D 1 of 3 | first-steps, the chip plants a first seed in one tap | Same race. | flake |
| 2026-10-12 | 38313125165 | 962ed452 | 2D 1 of 3 | first-steps, the chip plants a first seed in one tap | The step waited for the Plant a seed chip to show, then clicked it, but Gather all can take the chip's place once the world works out what lies within reach, after the chip showed. The click is what's retried now, with Gather all pressed first (5be2009a). | flake |
| 2026-10-09 | 37958504628 | d625b87c | 2D 1 of 3 | feed, the newest devlog post on the wall | The step looked for a heading in the post's rest, and the 2026-10-07 post has none; it looks for a paragraph now (1d8d0776). The other four feed tests failed on the retry's names already taken. | test out of date |
| 2026-10-07 | 37675823806 | 3dabbcbf | 2D 2 of 3 | smoke, taps walk around the Town Hall | A new chip in the world's button column covered the tiles the test taps, and a person taps. | real bug |
| 2026-10-06 | 37509857194 | eab10663 | 2D 1 of 2 | docs, phone | Past the 30-second test timeout on a busy runner. CI gives 60 seconds since decision 0109. | flake |
| 2026-10-06 | 37508112455 | d85ce955 | 2D 2 of 2 | shop, Halloween | Past the 30-second timeout as one long test. Split into its own test (eab10663), then decision 0109. | flake |
| 2026-10-06 | 37507619840 | 63a04a6a | 3D | three-d, a plot opens in 3D | Software WebGL didn't draw within the timeout. The plot view runs nightly since decision 0200. | flake |
| 2026-10-06 | 37505707606 | ea758bda | 3D | three-d, at midnight | Software WebGL timeout (screenshot). Nightly since decision 0200. | flake |
| 2026-10-06 | 37504747396 | e2e3c1a3 | 3D | three-d, at midnight | Software WebGL timeout (reading the photo). Nightly since decision 0200. | flake |
| 2026-10-06 | 37503196553 | 796d7df5 | 3D | three-d, at midnight | Software WebGL didn't draw within the timeout. Nightly since decision 0200. | flake |
| 2026-10-06 | 37485747625 | 29f3812a | 3D | three-d, a plot opens in 3D | Software WebGL timeout during a fixed wait. Nightly since decision 0200. | flake |
| 2026-10-06 | 37484818854 | d9c30240 | 3D | three-d, at midnight | Software WebGL timeout (screenshot). Nightly since decision 0200. | flake |
| 2026-10-06 | 37484428611 | 6ecbe7a1 | 3D | three-d, at midnight | Software WebGL timeout (taking the photo). Nightly since decision 0200. | flake |
| 2026-10-06 | 37483500537 | 00a8c0de | 3D | three-d, at midnight | Software WebGL timeout (taking the photo). Nightly since decision 0200. | flake |
| 2026-10-06 | 37477249879 | 91fce424 | 3D | three-d, at midnight | Software WebGL timeout (taking the photo), the day the night test was added. Nightly since decision 0200. | flake |
| 2026-10-06 | 37474089271 | 9250fab6 | 3D | three-d, a plot opens in 3D | Software WebGL timeout during a fixed wait. Nightly since decision 0200. | flake |
| 2026-10-06 | 37448753670 | 17279867 | 2D 1 of 2 | docs, the main bar links to the docs | The page outgrew the step's 5-second wait for its heading as the API grew; it got 20 seconds (1bee7c72). | test out of date |
| 2026-10-06 | 37448474223 | 76b38a56 | 2D 1 of 2 | docs, the main bar links to the docs | Same 5-second wait. | test out of date |
| 2026-10-06 | 37447583288 | 4f2283c1 | 2D 1 of 2 | docs, the main bar links to the docs | Same 5-second wait. | test out of date |
