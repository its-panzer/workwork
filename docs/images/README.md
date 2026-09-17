# Demo images

The dashboard and jewel are actual Electron renders from workwork's isolated demo, with fictional tasks and no real agent connections.

| Image                                                 | Contents                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| [Open dashboard over WoW](workwork-dashboard-wow.jpg) | 3200 × 1800 demo composite.                                      |
| [Collapsed jewel over WoW](workwork-jewel-wow.jpg)    | 3200 × 1800 demo composite, with the jewel at the same position. |
| [Standalone dashboard](workwork-demo.png)             | 1360 × 1440 transparent app capture.                             |
| [Standalone jewel](workwork-jewel.png)                | 168 × 168 transparent app capture, showing two waiting tasks.    |

The composites render the real interface over a static screenshot. They do not show a running WoW client or prove game/fullscreen compatibility. The screenshot is not used by the app, and no game interface or game scene was generated with AI.

## Background credit

World of Warcraft Classic screenshot © Blizzard Entertainment, Inc. Source: **WoW Classic Westfall 3840x2160**, from Blizzard's [World of Warcraft — BlizzCon 2018 press kit](https://blizzard.gamespress.com/Kit/Details/World-of-Warcraft---BlizzCon-2018).

The Blizzard background retains its own copyright and is **not covered by the repository's MIT license**. The workwork interface, original artwork, and standalone captures are MIT-licensed. workwork is independent and is not affiliated with or endorsed by Blizzard Entertainment.

## Capture notes

`npm run smoke` creates the standalone dashboard and jewel captures in the ignored `artifacts/` directory. The two WoW composites were captured from an isolated copy of the same demo frontend, on a 1600 × 900 canvas at 2× scale, with the official screenshot as a CSS background. The pane keeps its normal 680 × 720 layout and the collapsed jewel remains 84 × 84; only their placement on the larger canvas changes.

No personal desktop, account data, agent settings, or real conversations appear in these images.
