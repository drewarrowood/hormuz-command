# Hormuz Command

A turn-based browser game about commanding a US-led escort and counter-mine watch in the Strait of Hormuz, November 2026. Fourteen days. Limited escorts, hunters, fighters, patrol aircraft, and ISR. The oil either moves or it sits at Fujairah.

**Illustrative. Not official data. Not a forecast. Not operational advice.**

Once GitHub Pages is enabled, the watch is at:

**https://drewarrowood.github.io/hormuz-command/**

## Play locally

No install and no server required. Clone the repo and open `index.html` in a browser. Classic scripts, no build step, no account, no network calls during play.

Or, from the repo root:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080/

A campaign autosaves in this browser only (`localStorage`). Abandon watch clears it. The seed on the title screen replays the same luck with different orders.

## How the watch works

You are the escort commander for 14 days, 18 November through 1 December 2026.

Each morning you read an intel feed that separates **confirmed** desk notes from **unconfirmed** press and opposing claims. Then you assign:

- escort ships (convoy screen or a lane picket)
- minehunters, by lane
- combat air patrol, including optional strikes on military launch sites or fast-attack boat bases
- maritime patrol
- ISR

and you set three policies: convoy size (small, standard, or massed), who may sail without an escort, and which lane the traffic uses.

Bare transits are hit much more often than escorted ones. The untouched baselines, from the lab sketch this game is built on, are **5.5% unescorted** and **1.2% escorted** per transit. Air cover, mines, the lane, jamming, convoy density, and escalation move those numbers. The in-game staff estimate shows the modified chance before you commit. It is not a promise.

Massed convoys cover more ships with the same escorts and take follow-on hits when a group is found. Escort-only holds uncovered ships at Fujairah; some owners cancel. Flow-first sails them bare. Strikes can suppress drones and missiles for a short time and raise an escalation meter, which brings retaliation, higher insurance, and attacks on Gulf partners. There is no civilian target, and chasing one is not a way to win.

The lane chip is your picture, not the truth. Mine claims often resolve a day or two later, confirmed or not.

The target band on the scoreboard is **13 to 14 million barrels a day** (staff target 13.5). Cargo is an illustrative **433,000 barrels a ship**. Demand is about **30 ships a day**, in the same range as recent public facilitated-transit tallies of roughly 28 to 34. Peacetime flow, for contrast only, is carried as about 20 million barrels a day. A simpler 14-day lab draw is in [`data/lab-last-run.csv`](data/lab-last-run.csv) (about 13.6 mb/d, 12 hits, no mines and no owner panic).

The after-action review grades flow, hits, crew, your own losses, escalation, the mine picture, blind strikes, and whether you chased claims that did not hold.

In-game sources and the full rules are on the **How to play** and **Sources and caveats** screens.

## GitHub Pages

The site is static. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes it with `actions/deploy-pages` on every push to `main`.

Pages will not update until the repo setting points at GitHub Actions:

1. Open the repository **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).
3. Merge to `main`, or run the “Deploy GitHub Pages” workflow by hand.
4. The workflow’s environment URL should settle at https://drewarrowood.github.io/hormuz-command/

If Pages was never turned on, that settings change is the step this repo cannot do for you. After it is set, pushes to `main` deploy on their own.

## Tests

The campaign model can be checked without a browser:

```bash
node tests/balance.js
```

That runs invariant checks and a spread of strategies. It does not start a server.
