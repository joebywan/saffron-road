# Developing Saffron Road

Everything behind the game: running it locally, how releases work, how the
offline machinery updates itself, and why the UI is built the way it is.
Installing is [INSTALL.md](INSTALL.md).

## Run it

```bash
npm start
```

Then open <http://localhost:8123>. To reach it from a phone on the same wifi, see
**On a phone** below.

The setup screen asks two things — how many bots, and how good they are — and both are
one tap. There are no name fields: you are "You" and the bots take stock names. The replay
seed is behind **More options**; turn pacing, the move log, all players and New game are in
the in-game menu.

**One human, always.** A game is you plus one to three bots, and the board is drawn from
your seat and only your seat: card costs carry *your* discounts and the rail carries *your*
tokens on every turn, including while a bot is moving. Whose turn it is is said in the turn
indicator and narrated in the move log — the board is never reinterpreted around you. (The
engine itself is unchanged and still seats any mix of humans and bots; `src/ui/seat.js` is
where the UI pins itself to one of them.)

Any static file server works — `python3 -m http.server` from this directory is fine too.
It **must be served over HTTP** — opening `index.html` as a `file://` URL will not work,
because browsers block ES modules loaded cross-origin.

For offline play there is a single-file build:

```bash
npm run bundle
```

That inlines everything into `index.single.html`, which *does* open straight off disk by
double-clicking. It makes no network requests at all.

## Test it

```bash
npm test
```

## Keeping it up to date

A project with no dependencies still has dependencies; they are just not in
`package.json`. They are the `uses:` pins in the two workflows, the Android
plugin, the Gradle distribution, and the four coordinates in
`android/app/build.gradle`. Renovate watches all of them, opens a pull request
per change, waits for CI, and merges the safe ones itself.

It runs from `.github/workflows/renovate.yml` on a schedule, twice a day. The
rules live in `renovate.json5`, which explains what merges itself and what
does not — the short version is that anything Android, and any major version,
gets a human. `Dependency dashboard` is a single open issue listing everything
pending; if it never changes, nothing is running.

Actions are pinned to commit SHAs rather than tags, with the version in a
trailing comment. A tag is a pointer someone else can move — which is how the
tj-actions compromise reached everyone who referenced one — and a pointer that
moves under a name that does not change is the one thing waiting cannot
protect against. Renovate rewrites the SHA and the comment together, so they
stay readable and stay current.

### Releasing what it merged

Merging to `main` ships nothing on its own — a release is a `v*` tag, and an
installed app only sees a release. So `.github/workflows/monthly-release.yml`
tags the next patch version on the 1st of each month, and `release.yml` builds
it exactly as it would for a tag pushed by hand.

It asks three questions first, and any `no` means no tag: has anything since
the last tag actually touched the app (workflow and README changes do not
count), is CI green on `main`, and is there a previous tag to count from. A
quiet month produces no release, which is the point.

Only ever a patch bump. This job ships accumulated dependency updates, and
numbering those as a minor would make the version lie about what is in it —
minors and majors stay hand-tagged:

```bash
git tag v1.6.0 && git push origin v1.6.0
```

### main is protected

`test` and `Android APK builds` are required, and
nothing reaches `main` except through a pull request that passed them. There is
no required approval — on a repo with one maintainer that would mean no bot PR
ever merges, since there is nobody to approve it.

Both names are load-bearing twice over: the protection rule waits for
checks matching them exactly, and `platformAutomerge` is only safe *because*
they are required. Rename a job and the rule waits for a check that will never
report — and a protection rule with nothing required lets GitHub merge failing
PRs. Rename them together or not at all.

Admins are not included in the rule, so an emergency push is still possible.

### The one-time setup

Renovate authenticates as a GitHub App rather than a token, because it needs to
write to `.github/workflows/` **and** read check runs, and no personal access
token can do both — see the comment at the top of the workflow for why. Setting
one up, once:

1. **Settings → Developer settings → GitHub Apps → New GitHub App.** Name it
   anything. Homepage URL can be this repo. Untick **Webhook → Active**.
2. Give it these **Repository permissions**, and nothing else:
   Contents `read & write`, Pull requests `read & write`,
   Issues `read & write`, Commit statuses `read & write`,
   Workflows `read & write`, Checks `read only`, Metadata `read only`.
3. Create it, then **Generate a private key** — a `.pem` file downloads.
4. **Install App** → this repository only. Not "all repositories".
5. In this repo, **Settings → Secrets and variables → Actions**, add two
   secrets: `RENOVATE_APP_CLIENT_ID` (the **Client ID** on the App's settings
   page — `Iv23li...`, not the numeric App ID above it) and
   `RENOVATE_APP_PRIVATE_KEY` (the whole `.pem` file, `BEGIN` and `END` lines
   included).
6. **Actions → Renovate → Run workflow**, to check it before trusting the cron.

Delete the `.pem` from your downloads afterwards; the secret is the copy that
matters, and a private key in a Downloads folder is a private key someone else
can find.

### When it breaks

It will eventually — a rotated key, a rate limit. A failed scheduled run
notifies nobody by default, so the workflow opens an issue called
`Renovate is not running` instead, and comments on that same issue rather than
filing new ones. That issue is the signal. If updates have gone quiet and there
is no such issue, check the Actions tab: GitHub disables scheduled workflows
after 60 days without repository activity, and re-enabling one is a button.


## How the board is laid out

There is one, and it is built for a handset. The page is not a document you scroll but an
app shell that **does not scroll at all**: a turn takes zero vertical scrolling at both
412x915 and 360x780, which is the whole point of it.

It renders at any width — `.main` caps it at 560px and centres it — so opening the game on
a laptop shows the same board in the middle of the window. There used to be a second, wide
layout above 720px, with a side panel, a page header and its own card and cost renderers.
It is gone. The cost of it was never the code: it was that every change had to be reasoned
about twice, and the two could disagree. They did, twice in consecutive releases — the turn
report and the cost pips each spent a version saying different things depending on how wide
the window was.

```
appbar     round · whose turn · menu
opponents  one strip: seat, name, cards bought, points — tap for the full panel
companies  one thin row of requirement pips
CARDS      3 rows of (deck + 4 cards). All twelve visible, costs on the face
you        your points, one chip per colour (tokens / cards), reserved cards
bank       six piles and the action bar, both under your thumb

           ...and, only while the bots are moving, the turn report in front of
           all of it — see "A turn is a beat". It is not in this list because
           it is not in the layout: it costs no height at all on your own turn.
```

**Tapping a card selects it**, and the single action bar at the bottom switches to Buy /
Reserve for that card with what it costs you. Tapping a deck offers Blind reserve the same
way, and with nothing selected the bar is the goods take. That is what lets a card tile be
71px wide: the per-card buttons were what forced a card to be 132px, and they were the
touch-target problem. Goods and a card are mutually exclusive selections, because they are
two different turns.

**A card's cost is what is printed on it, and it never changes.** The app does not quietly
subtract your discounts and show you the remainder — you do that one step of arithmetic
against the rail directly below, exactly as you would at a table. Colours your cards already
cover are **dimmed** rather than removed or rewritten, so the discount is visible without a
number ever moving.

That is a deliberate reversal. The cost used to be shown after discounts, and it cost more
than it bought:

- **The figure moved under you.** Buy one white card and every white-costing card on the
  board silently re-labelled itself. You could not learn the board, because "the 3-white one"
  became the 2-white one. A cost is a property of the card; what your cards take off it is a
  property of you.
- **Fully covered colours vanished from the card entirely**, so a card's cost could lose a
  whole pip between glances.
- **It was never disclosed**, and it contradicted the rail, which shows your tokens and your
  discounts *separately*. Reading the two together — which is exactly what you do when
  deciding whether to buy — counted the discount twice and made an unaffordable card look
  paid for.

Whether you can *afford* something is a separate question with its own answer, and it never
needed the numbers to move: affordable cards carry a **green ring**, and on the action bar
the colour you cannot cover is **ringed in red**. (Cards in the grid are deliberately not
ringed red: at the start of a game every colour on every card is short, and twelve cards
edged in red say nothing.) The words are there for a screen reader, in the tile's label, and
in the toast a tap on the disabled Buy button raises.

Beyond that the bar does not restate the sum. Your own tokens are in the rail directly above it, so the
subtraction was chrome — and on a four-colour Route card it pushed the narrowest bar in
the app to three lines. Buy is still disabled by exactly the same rule (the move is not in
`legalMoves`), and the reason is still spelled out in words on the button, in its
accessible name and in the toast a tap on it raises: a screen-reader user cannot glance
between the card and the rail, so for them the sentence is the only version there is.

Everything that is not part of taking a turn is behind a tap: opponents' full panels, all
players side by side, the move log, the seed, turn pacing, Install and New game. The move
log is still rendered, just clipped, with the sheet as the visible copy; the region that
narrates a turn out loud is now the report — which on a phone lives inside the beat popup,
so that exactly one live region is ever speaking.

## A turn is a beat

Three bots moving one after another used to be a stream of numbers changing with no visible
cause — by the time you had read one seat's tokens the next seat had spent theirs. So a turn
ends in a **report**, carrying both halves of the answer.

```
② Ada  took ◆1 ●1 ▪1
0 pts  ◆0/0  ●1/0  ■1/0  ●1/0  ▪0/0  ●0        [ Next ]
```

What they did is in the same stones the board uses everywhere else, and under it is where
that left them: points, and one chip per colour with their tokens and their card discounts.
Over a round you see every bot's position, each shown at the moment it changed. A
blind-drawn reserve says "a Route, unseen" and nothing more, exactly as the rules require.

**On a phone it is a popup over a blurred board, not a strip of the board.** Inline it held
about 70px for the whole game to say something that is only true between turns; the card
grid was paying for it, and at 360x780 a Routes row was down to 117px and its cost stones
had to shrink to fit. In front of the board it costs nothing when nobody is moving. The
same three rows are now **138px** each and the stones went back up from 16px to 19px, with
the fourth one still clearing the tile by 6px. The blur also does a job words were doing:
"this is not yours to touch yet" no longer has to be explained by a disabled control, and a
tap anywhere becomes the press — which inline was impossible, because the board was directly
under the player's thumb.

**It opens once and closes once per run of bots** — whatever the pacing, and however many
bots are at the table. Every report rotates through that one popup: the contents change, the
backdrop does not. Three bots must not mean three full-screen blurs blinking in and out a
round; that is a photosensitivity hazard before it is a taste question, and it is why the
backdrop is built once and left alone, why nothing inside it moves, and why the seat that is
mid-move gets a still line rather than a pulsing one. The fade it arrives with is the
opposite of a flash, and `prefers-reduced-motion` turns even that off.
`prefers-reduced-transparency` swaps the blur for a solid panel — still reading as blocking,
which is the point of it.

Freed from the layout, the report is also no longer clipped: inline it had to be a fixed two
lines, because a region that grew a line when a bot bought a four-colour card would resize
the card grid under the player's thumb. Floating over the board it owes the grid nothing, so
the action line wraps and says the whole sentence.

Tapping the status line opens **All players** — every seat side by side. The rotation is the
right shape for following the game and the wrong shape for comparing two bots, and three
permanent strips do not fit on one screen.

**Turn pacing** is one setting with three modes, in the menu:

| | |
| --- | --- |
| **Press to continue** (default) | the game holds on each bot's report until you press Next — or tap anywhere on the backdrop. Your own turn never waits — you just made the move. |
| Normal | auto-advances after about 0.7s, as it always did. |
| Fast | auto-advances almost at once. |

With three bots, "press to continue" is three presses a round. That is the point: the
default is legibility, and Fast is there for anyone who would rather watch the bots race.

**A report only ever exists for a fully resolved turn.** The over-ten discard, company
qualification and the win check are state-based actions in the *Magic: the Gathering* sense
— they resolve by themselves before the state can be observed, and repeat until none
applies. The report is sorcery-speed: it is composed once everything has settled. So a
bot's turn is painted exactly twice, before and after, and never mid-resolution: no flash of
a bot holding twelve tokens, no glimpse of its points before the company was added. (Your own
sub-phases still paint, because those are questions being asked of you.) The same ordering
is why the winning turn's report comes up first and the standings wait behind it — the cause
before the result.

**The standings can be put away.** They are the one panel in the game you do not owe an
answer to — unlike the over-ten tray or a company choice, which the turn does not continue
without — so a tap on the scrim, or Escape, dismisses them and leaves the finished board on
screen. A game that has just ended is worth looking at: whose engine beat you, which company
went where, what was still on the board. Before this they covered all of it and the only way
past was to start another game — and worse, the menu was suppressed for the whole `gameover`
phase, so **New game itself was behind the panel it was trying to replace**. Sheets are now
suppressed only while the standings are actually up.

Dismissing them is not losing them: the game-over line in the status bar becomes the way
back, and the menu grows a **Final standings** row.

**Nothing a bot does may kill the turn loop, and nothing it does may stop the board
silently.** A whole bot turn — the move, the sub-phases and both of its renders — runs inside
one `try`. If the seat still cannot be moved on, the game says so where the player is
already looking — the popup, which holds open for it — and offers the way out:

```
② Ada  could not take a turn
The game is stopped here. Carry on plays this seat's next legal move.   [ Carry on ]
```

**Carry on** is not a reset and not a skipped turn: it plays the engine's own first legal
move for whatever phase that seat is stuck in — an action, a discard, a company, or the `pass`
the engine keeps for a board where nothing else is possible — and the loop picks the game
back up from there. Before this, a bot turn that threw left the board with a seat to act and
nobody acting, the reason for it in a console no phone player will ever open, and no way out
but a new game.

Numbers that change **run to their new value** rather than jumping, over about 280ms
(`src/ui/tick.js`). That lags the display and nothing else: the state is applied
immediately, every decision reads the state, and an interrupted tick, a hidden tab or
`prefers-reduced-motion: reduce` all land on the truth at once.

Every control you tap during a turn is at least 44x44 CSS px; the smallest on the board is
exactly 44. Safe-area insets keep the bar out from under a notch and the action bar off
the home indicator, and `prefers-reduced-motion` still turns the movement off.

## Off disk

`npm run bundle` still produces a double-clickable `index.single.html`, and the bundler
strips the PWA block out of it: a `file://` page has no origin to install to and no `sw.js`
beside it, so there is nothing to register and nothing to fetch. It makes no network
requests at all, exactly as before.

## The screenshots in the README

```bash
npm run screenshots
```

Rewrites `docs/screenshots/*.png`. It needs `firefox` on `PATH` and nothing
else — no driver and no automation dependency.

The positions are not mocked. It plays real games with the real engine and the
real bots from a fixed seed, keeps the first position matching what the shot is
meant to show, and falls back to the best near-miss if that position never came
up — bots are stochastic, and a generator that only works on a lucky seed is one
nobody reruns. Each state is then written into a scratch Firefox profile's
localStorage by a temporary same-origin page, and a *second* Firefox run loads
the app, which restores that saved game on boot exactly as it would on a phone.
That second run is what is captured. Two runs, because localStorage persists in
a profile between them and headless Firefox cannot be scripted mid-page.

It forces `ui.systemUsesDarkTheme`, because the installed app is always dark
and a fresh browser profile is not.

Run it after any visible UI change. A screenshot of a UI that has since moved is
worse than no screenshot.

## Where things live

| Path | What it is |
| --- | --- |
| `src/contract.js` | Shared types + constants. The interface every module agrees on. |
| `src/rng.js` | Seeded PRNG — same seed replays the same game exactly. |
| `src/data/cards.js` | The 90 holding cards. |
| `src/data/companies.js` | The 10 company tiles. |
| `src/data/verify.js` | Asserts the dataset's invariants. Run it directly. |
| `src/engine.js` | All the rules. Pure: `applyMove(state, move) -> newState`. |
| `src/bots.js` | Bot opponents. |
| `src/ui/` | Rendering and interaction. |
| `src/ui/seat.js` | Which seat the player is in — the one fixed viewpoint the whole UI draws from. |
| `src/ui/report.js` | What a completed turn was, and the three turn-pacing modes. |
| `src/ui/tick.js` | Numbers that run to their new value instead of jumping. |
| `src/ui/pwa.js` | Service-worker registration and the Install button. All of it optional. |
| `manifest.webmanifest` | The web app manifest: name, colours, icons, standalone display. |
| `sw.js` | The service worker. Precaches the shell so the game plays offline. |
| `icons/` | The install icons, generated by `tools/icons.js`. |
| `tools/serve.js` | The dev server behind `npm start`. |
| `tools/bundle.js` | Inlines everything into one HTML file. |
| `tools/silhouette.html` | The colour-blind check: all six cuts as flat black shapes, numbers knocked out, at pip size. `npm start` then `/tools/silhouette.html`. |
| `tools/screenshots.mjs` | Rewrites the README's screenshots from real seeded games. `npm run screenshots`. |
| `tools/icons.js` | Redraws `icons/` **and** the Android launcher icons from the app's own crocus mark. `npm run icons`. |
| `android/` | The native Android wrapper: one activity, one WebView. `npm run apk`. |
| `android/apk.sh` | Finds the SDK and a workable JDK, then runs `./gradlew assembleDebug`. |
| `android/app/src/main/java/…/MainActivity.java` | The whole app. Asset loader, insets, back button. |

## Card data

The 90 card costs in `src/data/cards.js` are **transcribed, not invented, and not free to
edit**. They were cross-verified across four mutually independent encodings that agree on
every card exactly, out of roughly thirteen independent origins in the same agreement set.
A fifth was rejected as an outlier: it disagreed on 46 of the 90, is not a colour
permutation of the others, and its own claim to have been cross-verified does not hold.

If a cost here looks wrong, it is far likelier to be right. Three things that commonly-
repeated summaries get wrong, all asserted in `verify.js`:

- Total card points are **140**, not 145. The per-colour Warehouse point spread is 1,1,2,2,2,3.
- **Six Caravan cards do cost their own bonus colour.** It is not true that they never do.
- The Route cards costing **7 of a single colour are the 4-point ones**. The 5-point cards
  cost 7 of one colour *plus* 3 of another.

The ten **company** requirement rows are likewise a unanimous consensus across six
encodings, and the set is perfectly balanced: each resource is wanted by exactly five tiles.
`verify.js` asserts that balance, so an edit fails the build rather than quietly skewing the
game. The company names are this game's own and are pure flavour — change them freely.

Run `node src/data/verify.js` to re-check the whole dataset.

## Design notes

**The engine is pure.** `applyMove` never mutates its input; it returns a new state.
That is what lets bots search forward by simulating moves, and it makes the whole game
trivially replayable from a seed.

**A pip is one element: the stone, with its number on it.** A cost, a bank pile, a holding
and a card discount are all "this many of this stone", so all of them are drawn the same
way — the count rides on the token. There is no letter glyph and no separate number beside
the stone any more; that pairing cost two elements of width in the dozens of places a pip
appears, and the width it gave back went into the cards.

**Colour is never the only cue, and the words are not the cue at all.** With the letter
gone, the redundant non-colour cue is the *silhouette*: six deliberately different outlines,
one per good plus the coin, which stay tellable apart as flat black shapes with the digits
knocked out of them. They are not variations on one form — saffron is loose threads and
pepper is three separate corns — because a set of near-identical outlines is a set that
fails exactly this test.
`tools/silhouette.html` is that check, at the sizes the app actually draws, magnified to
the real pixels; `TOKEN_NUMBER` in `src/ui/tokens.js` is where each cut says how much of its
body a number may use. The digit's contrast is not left to the facet it lands on either:
it is stroked with the stone's own paired scrim colour under `paint-order: stroke`, so the
ink is only ever seen against that halo. The visible *words* are: the tiles print no
goods names, and no company names either, because players recognise the stone and the
pips, not the label. Every `aria-label`, title and unavailable-button reason still gives
the real name of the good, so what a screen reader hears did not change when the letter came
off the stone.

**Tokens and cards are one chip, and never look alike.** Spendable tokens ride on the
stone; the permanent card discount sits beside it in a little card — a bordered box with a
coloured spine, the same shape the opponent strip uses for a card count. One chip per
colour instead of a stone, a number and a badge. They mean very different things, so shape,
size and weight all separate them, and the accessible name says which is which in words
rather than leaning on any of that: "2 Indigo tokens, 1 Indigo card discount".

**Bots cannot cheat.** They are handed `redactFor(state, i)` — deck order stripped,
opponents' *blind-drawn* reserved cards hidden (see the reserving rules below). A bot
that wants to search calls `determinize()` to sample one plausible concrete world from
what it can actually see; it fills the still-hidden slots only and never re-rolls a card
that is already public.

