# Red e2e runs

Every red e2e run on `main` or the nightly gets a line here, newest first (e2e/AGENTS.md). The cause is one of: a real bug (the product broke, and e2e caught it), a flake (the test's own timing or setup failed on a working product), or a test out of date (the product changed on purpose and the spec didn't follow). A flake also says what was done about it. Read a run's failure with `gh run view <id> --log-failed`.

| Date (UTC) | Run | Commit | Job | Spec, test | Cause | Kind |
|------------|-----|--------|-----|------------|-------|------|
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
