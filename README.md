# Saffron Road

A trading game for the phone, with bot opponents. You against one, two or three
of them: buy caravans and warehouses along a spice route, take the goods that
pay for them, and get the trading companies to sign with you.

No build step, no dependencies, no framework. Plain ES modules.

There is also a real Android app — a sideloadable APK that carries the whole game inside
it and needs no server and no host. See **On a phone**.

**This is a phone game.** There is one layout and it is built for a handset: it renders at
any width, capped and centred, so a laptop shows the same board rather than a second design
of it. There used to be a separate wide layout; it is gone, along with the Linux desktop
packages that existed to run it. What is shipped is the APK and the web app.

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

## On a phone

Three routes, and they are **not** equivalent — which is the part that trips people up.

| | Real app icon | Works offline | Needs a server or a host |
| --- | --- | --- | --- |
| **Android APK** — `android/` | yes | yes | **no** |
| PWA installed from an https host | yes | yes | an https host |
| `http://192.168.x.x:8123` over wifi | no | no | a laptop on the same wifi |

On Android the APK is the one to reach for. Everything else on this list exists because
browsers make you earn an install; the APK just *is* an app.

### Path 1 — the Android app (Android only, and the best of the three)

`android/` is a small native project — one activity, one WebView, no Capacitor, no
Cordova, no React Native. The web app is already self-contained; it needs a window, not a
framework.

The result installs like any other app, gets a launcher icon, opens without browser
chrome, and plays with the phone in aeroplane mode. It does not even ask for the
`INTERNET` permission, so "offline" is not a promise — it is the only thing it can do.

Portrait, dark, `minSdk 24` (Android 7.0) targeting API 36. Back goes back in the page's
history and otherwise wants a second press to leave, so one stray swipe cannot throw away
a game in progress, and the screen stays on while you think.

#### One time: the Android SDK

You need a JDK and the Android SDK. Neither is needed to *run* the web app; this is
purely to build the APK.

```bash
# 1. A JDK between 17 and 25. Gradle will not start on anything newer, and
#    the Android plugin needs at least 17. A newer default java is fine —
#    android/apk.sh finds a usable one and uses it just for the build.
sudo apt install openjdk-21-jdk        # or Temurin, or whatever you like

# 2. The SDK command-line tools, unpacked where the SDK expects them.
mkdir -p ~/Android/Sdk/cmdline-tools
cd /tmp
curl -O https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q commandlinetools-linux-13114758_latest.zip
mv cmdline-tools ~/Android/Sdk/cmdline-tools/latest

# 3. Licences, then the platform and build tools.
export ANDROID_HOME="$HOME/Android/Sdk"
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
    "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

About 1.5 GB of SDK, plus roughly another 1 GB of Gradle distribution and caches under
`~/.gradle` the first time you build. On macOS the SDK conventionally lives at
`~/Library/Android/sdk` and `apk.sh` looks there too; anywhere else, set `ANDROID_HOME`.

There is no separate Gradle to install — `android/gradlew` fetches the exact version it
wants on first use.

#### Build it

```bash
npm run apk
```

That is `android/apk.sh`, which locates the SDK, picks a JDK Gradle will run on, and
shells out to `./gradlew assembleDebug`. A **debug** build, because this is the local
development path — what CI publishes is `assembleRelease`, and the difference matters
(see *What ships is a release build*, below). Equivalent, if you would rather drive
Gradle yourself:

```bash
cd android && ANDROID_HOME=~/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDebug
```

It lands at `android/app/build/outputs/apk/debug/app-debug.apk`, about 3 MB.

#### Install it

Enable developer options and USB debugging on the phone, plug it in, accept the
"Allow USB debugging?" prompt, then:

```bash
adb devices                                                   # confirm it is listed
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`-r` reinstalls over an existing copy and keeps its data. Copying the `.apk` to the phone
and tapping it works too, once you let the file manager install unknown apps.

#### What ships is a release build

`npm run apk` builds the **debug** variant, which is right for a laptop: it is debuggable,
which is what you want when attaching a debugger.

Every published release is `assembleRelease`, and that has not always been true. From
v1.0.0 to v2.2.0 the release workflow ran `assembleDebug`, so **fifteen releases went out
with `android:debuggable="true"`** — anyone able to reach the device over adb could attach
to the process and read the storage of an app whose entire pitch is that nothing leaves it.
It is also the profile Play Protect scrutinises hardest, and updating over an existing
install is exactly when it offers to scan.

A debuggable APK installs, runs and looks identical, so nothing surfaced it. Both workflows
now build the release variant, and `release.yml` fails if the APK it is about to publish
reports `application-debuggable`.

#### One uninstall, once, and then upgrades work

**Releases up to and including v1.6.0 cannot be installed over each other.** If Android
tells you *"The app wasn't installed"* with no reason, that is why. Uninstall the app once,
install the new one, and every release after that upgrades in place.

The cause was that `android/app/build.gradle` declared no signing config, so `assembleDebug`
fell back to `~/.android/debug.keystore` — **which Gradle generates when it is missing**. On
a laptop that file persists and the key is stable by accident. On an ephemeral CI runner
there is no such file, so every release build minted a brand new random key:

| release | certificate SHA-256 |
| --- | --- |
| v1.3.0 | `2b5bba86…` |
| v1.4.0 | `d9af206b…` |
| v1.5.1 | `6a856be9…` |
| v1.6.0 | `6fa32ff3…` |

Android refuses to install an APK over one signed by a different key, and the installer
reports that as the bare string above with nothing attached. The `versionCode` work was a
real fix for a real bug, but it was never enough on its own: **the signature is checked
first**, so a rising `versionCode` on a re-keyed APK still fails — which is exactly why the
release workflow's `versionCode` check passed while the install did not.

Releases are now signed with one stable key held in repo secrets, and
`.github/workflows/release.yml` refuses to ship an APK whose certificate is not the
fingerprint in `android/release-key.sha256` (a public value — it is a hash of the
certificate, not of anything secret). Rotating the key deliberately means updating that file
and accepting that everyone needs one more uninstall.

Local builds still fall back to your own debug key, so an APK you build yourself will not
install over a released one either. To build one that does, point the build at the same
keystore:

```bash
SAFFRON_KEYSTORE=/path/to/saffron-road-release.jks SAFFRON_KEYSTORE_PASSWORD=… SAFFRON_KEY_ALIAS=saffron SAFFRON_KEY_PASSWORD=… npm run apk
```

#### This is a personal sideload build, and that is not a formality

- It is signed with a key that exists only for this app, kept in repo secrets and never in
  the repo. `.gitignore` excludes `*.jks` and `*.keystore`, and no keystore should ever be
  committed. A build with no key configured falls back to the shared **debug key**, which is
  fine for putting an app on your own phone and is not fine for anything else.

#### How it gets away with no server

The game is plain ES modules, and every browser — WebView included — treats a `file://`
document as an opaque origin and refuses to load modules into it. So the APK does not use
`file://`.

Instead `androidx.webkit`'s `WebViewAssetLoader` answers requests for
`https://appassets.androidplatform.net/` out of the APK's own `assets/`, inside the
process, with no socket involved. (`androidplatform.net` is reserved by Google for exactly
this and never resolves publicly.) That single move buys three things:

- a real https origin, so `import` works exactly as it does on a server;
- a **secure context**, so `sw.js` registers and the existing offline machinery runs
  unchanged rather than being bypassed;
- a stable origin, so `localStorage` keeps your setup **and your game in progress**
  between launches.

The web app inside the APK is not a copy. A Gradle task syncs `index.html`, `styles.css`,
`src/**`, `sw.js`, the manifest and the icons straight from the repo root on every build,
and deletes anything that has gone away. There
is nothing under `android/app/src/main/assets/` to fall out of date, because there is no
such directory.

A second Gradle task stamps the service worker's version into that synced copy, and the
APK's own `versionCode`/`versionName` are derived from the tag rather than typed — see
[How a new version reaches an app you already installed](#how-a-new-version-reaches-an-app-you-already-installed).
Both used to be constants, and both stopped moving; between them, four releases in a row
were invisible on a phone.

The launcher icon is the app's own diamond mark, drawn by `tools/icons.js` — the same
script and the same geometry as the favicon and the PWA icons. `npm run icons` redraws all
of them at once.

### Path 2 — play over the LAN (no install, no offline)

Good enough for "everyone grab a phone, we're playing now". Start the server bound to every
interface instead of loopback only:

```bash
npm start -- --host
```

It prints the addresses to type into the phone:

```
Saffron Road running at http://localhost:8123
  on this network: http://192.168.0.229:8123  (wlo1)
LAN addresses are plain http, so no install and no offline there — see the README.
```

`HOST=0.0.0.0 npm start` and `SAFFRON_LAN=1 npm start` do the same thing; `PORT=8123`
picks the port. Both devices must be on the same network, and a firewall on the laptop will
happily eat the connection without saying so.

### Path 3 — host it over https (installs the PWA, and plays offline)

This is what a **browser** install needs, and only a browser install. It is not a
prerequisite for playing on a phone and it is not how the Android app gets there; if you
are on Android, Path 1 gives you the same offline app with nothing hosted anywhere.

#### The catch, stated plainly

A service worker only runs in a **secure context**. In practice that means exactly two
things: **https**, or **`localhost`**. `http://192.168.1.23:8123` is neither. It is plain
HTTP to a non-loopback host, so the browser hands the page no service worker at all — no
registration, no cache, no offline, and no install prompt. Nothing is wrong with the app
when this happens; the browser is refusing by design, and it does so silently.

(The APK sidesteps this entirely. `WebViewAssetLoader` gives the page a real https origin
served from inside the app, which *is* a secure context, so the same `sw.js` registers
there with no host in sight.)

#### Doing it

Any static https host works — GitHub Pages, Netlify, Cloudflare Pages. There is no build
step: push the repo, point the host at the root, done. `start_url` and `scope` are
relative, so serving from a subdirectory (a GitHub Pages *project* site,
`user.github.io/saffron-road/`) works without edits.

Then, on the phone: open the https URL, and take the browser's "Install app" / "Add to Home
Screen" offer — or use the **Install** button that appears in the header once the browser
says installation is available. After the first load the whole app is in the cache and the
game plays in aeroplane mode.

### What is actually cached

The service worker precaches the app shell — `index.html`, the stylesheet, every ES module,
the manifest and the icons — into a cache named after the build's version, and serves it
**stale-while-revalidate**: the cached copy comes back instantly, a fresh copy is fetched in
the background, and the cache is overwritten. Offline, the background fetch fails silently
and you keep playing on what is already there.

### How a new version reaches an app you already installed

This used to be broken in three places at once, and every one of them was invisible from
the outside — you released, and nothing changed on the phone. The first two are now derived
from the release rather than typed by hand, because a version somebody has to remember to
bump is a version that stops moving; the third was not a version at all.

**1. `sw.js` had `const VERSION = 'v1'`, for ever.** Every release shipped a byte-identical
service worker, so no browser ever noticed there was a new one, never re-ran `install`,
never re-precached — and the fetch handler was cache-first with no revalidation, so the
shell from the very first launch was served for the life of the install.

It now ships a `__APP_VERSION__` placeholder that each delivery path replaces with
`<tag>-<hash of the shell's bytes>`:

| path | what stamps it |
| --- | --- |
| web release | `.github/workflows/release.yml`, which knows the tag |
| Android APK | the `stampServiceWorker` task in `android/app/build.gradle` |
| by hand | `node tools/version.js --write .` |
| `npm start` | nothing — see below |

The hash half is the safety net: forget to tag and the version still changes the moment any
shipped file does. `node tools/version.js` prints what this tree would get;
`node tools/version.js --check` (which CI runs) fails if the placeholder is renamed,
committed already-stamped, or loses its fallback.

**`npm start` has no build step, so the placeholder is still there** — and that is fine and
supported. `sw.js` falls back to the version `dev`, with a stable cache name, and
stale-while-revalidate still delivers every edit on the next reload. Local development
never needs a build.

**2. The APK said `versionCode 1` in every release.** v1.0.0 through v1.2.1 all declared
themselves as versionCode 1 / versionName 1.0.0, and Android does not replace an installed
app's assets for an equal versionCode — so installing a new release over an old one left
the old web app in place. That is why clearing storage did not help (the stale files were
the APK's assets, not the caches) and why only uninstall-then-install did.

`versionName` and `versionCode` are now derived: `-PappVersion` (what the release workflow
passes, from the tag), then the nearest git tag, then `0.0.0-dev`. `versionCode` is
`major*10000 + minor*100 + patch`, so 1.2.1 is 10201 and it rises with every release, which
is the property Android actually enforces. `SAFFRON_VERSION=1.3.0 npm run apk` sets it for
a local build, and `npm run apk` prints the versionCode, versionName and service worker
version of the APK it just built.

**3. Every release was signed with a different key.** With no signing config declared,
the build fell back to `~/.android/debug.keystore`, which Gradle generates when it is
missing — and on an ephemeral CI runner it is always missing. So v1.3.0, v1.4.0, v1.5.1 and
v1.6.0 each went out under a brand new random key, and Android refuses to install an APK
over one signed by a different key. This one hid behind the other two: the signature is
checked BEFORE `versionCode`, so fixing the version was necessary and still left the install
failing, with the installer saying only "The app wasn't installed".

Releases are signed with one stable key from repo secrets now, and the release workflow
refuses to ship an APK whose certificate is not `android/release-key.sha256`. See
[One uninstall, once, and then upgrades work](#one-uninstall-once-and-then-upgrades-work) —
including the fact that this fix itself needs one final uninstall, because the keys it
replaces were random and are gone.

Once a new version has activated, the worker tells the page and a small **"A new version is
ready — Reload / Later"** bar appears. It reloads by itself only where there is nothing to
lose — the setup screen, or the moment you leave a game — never mid-turn: an update that
eats your game is worse than the stale build was.

### If an install is stuck on an old version

Where you stand depends on which artifact you have.

- **Browser / installed PWA, on a release from this change onward** — nothing to do. The
  worker refreshes the shell in the background on every load.
- **Browser / installed PWA, currently stuck on an old build** — it heals itself. The old
  worker's bytes and the new `sw.js` differ (the version is in the file now), so the
  browser's routine update check finds a new worker, installs it, and it precaches the new
  shell. Reload once more if the page still looks old.
- **Android, on v1.2.1 or earlier** — this one cannot self-heal, and clearing storage will
  not do it: the old APK is still installed and its assets are what the WebView is serving.
  **Uninstall the app and install the new APK.** It is a one-time cost; from the next
  release on, versionCode rises and installing over the top works normally.

The manual reset, for any browser or WebView that is still misbehaving:

```
Settings -> Apps -> Saffron Road -> Storage -> Clear storage      (Android app)
DevTools -> Application -> Storage -> Clear site data         (desktop browser)
Long-press the icon -> App info -> Storage -> Clear storage   (installed PWA)
```

That drops the caches, the service worker registration and the saved setup, and the next
launch downloads everything again.

### The layout

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
nobles     one thin row of requirement pips
CARDS      3 rows of (deck + 4 cards). All twelve visible, costs on the face
you        your points, one chip per colour (tokens / cards), reserved cards
bank       six piles and the action bar, both under your thumb

           ...and, only while the bots are moving, the turn report in front of
           all of it — see "A turn is a beat". It is not in this list because
           it is not in the layout: it costs no height at all on your own turn.
```

**Tapping a card selects it**, and the single action bar at the bottom switches to Buy /
Reserve for that card with what it costs you. Tapping a deck offers Blind reserve the same
way, and with nothing selected the bar is the gem take. That is what lets a card tile be
71px wide: the per-card buttons were what forced a card to be 132px, and they were the
touch-target problem. Gems and a card are mutually exclusive selections, because they are
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
subtraction was chrome — and on a four-colour tier III card it pushed the narrowest bar in
the app to three lines. Buy is still disabled by exactly the same rule (the move is not in
`legalMoves`), and the reason is still spelled out in words on the button, in its
accessible name and in the toast a tap on it raises: a screen-reader user cannot glance
between the card and the rail, so for them the sentence is the only version there is.

Everything that is not part of taking a turn is behind a tap: opponents' full panels, all
players side by side, the move log, the seed, turn pacing, Install and New game. The move
log is still rendered, just clipped, with the sheet as the visible copy; the region that
narrates a turn out loud is now the report — which on a phone lives inside the beat popup,
so that exactly one live region is ever speaking.

### A turn is a beat

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
blind-drawn reserve says "tier 3, unseen" and nothing more, exactly as the rules require.

**On a phone it is a popup over a blurred board, not a strip of the board.** Inline it held
about 70px for the whole game to say something that is only true between turns; the card
grid was paying for it, and at 360x780 a tier III row was down to 117px and its cost stones
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

**A report only ever exists for a fully resolved turn.** The over-ten discard, noble
qualification and the win check are state-based actions in the *Magic: the Gathering* sense
— they resolve by themselves before the state can be observed, and repeat until none
applies. The report is sorcery-speed: it is composed once everything has settled. So a
bot's turn is painted exactly twice, before and after, and never mid-resolution: no flash of
a bot holding twelve tokens, no glimpse of its points before the noble was added. (Your own
sub-phases still paint, because those are questions being asked of you.) The same ordering
is why the winning turn's report comes up first and the standings wait behind it — the cause
before the result.

**The standings can be put away.** They are the one panel in the game you do not owe an
answer to — unlike the over-ten tray or a noble choice, which the turn does not continue
without — so a tap on the scrim, or Escape, dismisses them and leaves the finished board on
screen. A game that has just ended is worth looking at: whose engine beat you, which noble
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
move for whatever phase that seat is stuck in — an action, a discard, a noble, or the `pass`
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

### Off disk

`npm run bundle` still produces a double-clickable `index.single.html`, and the bundler
strips the PWA block out of it: a `file://` page has no origin to install to and no `sw.js`
beside it, so there is nothing to register and nothing to fetch. It makes no network
requests at all, exactly as before.

## Layout

| Path | What it is |
| --- | --- |
| `src/contract.js` | Shared types + constants. The interface every module agrees on. |
| `src/rng.js` | Seeded PRNG — same seed replays the same game exactly. |
| `src/data/cards.js` | The 90 development cards. |
| `src/data/nobles.js` | The 10 noble tiles. |
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
| `tools/icons.js` | Redraws `icons/` **and** the Android launcher icons from the app's own diamond mark. `npm run icons`. |
| `android/` | The native Android wrapper: one activity, one WebView. `npm run apk`. |
| `android/apk.sh` | Finds the SDK and a workable JDK, then runs `./gradlew assembleDebug`. |
| `android/app/src/main/java/…/MainActivity.java` | The whole app. Asset loader, insets, back button. |

## Card data

`src/data/cards.js` holds the **authentic printed deck**, not an approximation. It was
transcribed by cross-checking four mutually independent published encodings — a 2015 Prolog
dataset, a 2016 JSON one, a 2017 Ruby one, and a CSV — which normalise to byte-identical
tuples across all 90 cards. One widely-copied dataset was **rejected**: it disagrees on 46 of
90 cards, and its own header claims a cross-verification that does not hold.

Three things about the real deck that commonly-repeated summaries get wrong, all confirmed
against every independent source and asserted in `verify.js`:

- Total card prestige is **140**, not 145. The per-colour tier-2 point spread is 1,1,2,2,2,3.
- **Six tier-1 cards do cost their own bonus colour.** It is not true that they never do.
- The tier-3 cards costing **7 of a single colour are the 4-point ones**. The 5-point cards
  cost 7 of one colour *plus* 3 of another.

The ten **company** requirement sets are likewise the unanimous consensus of six independent
sources, and the set is perfectly balanced: each resource is wanted by exactly five tiles.
The company names are this game's own and are pure flavour — change them freely. The
requirement rows are the verified part and should not move.

Run `node src/data/verify.js` to re-check the whole dataset.

## Design notes

**The engine is pure.** `applyMove` never mutates its input; it returns a new state.
That is what lets bots search forward by simulating moves, and it makes the whole game
trivially replayable from a seed.

**A pip is one element: the stone, with its number on it.** A cost, a bank pile, a holding
and a card discount are all "this many of this stone", so all of them are drawn the same
way — the count rides on the gem. There is no letter glyph and no separate number beside
the stone any more; that pairing cost two elements of width in the dozens of places a pip
appears, and the width it gave back went into the cards.

**Colour is never the only cue, and the words are not the cue at all.** With the letter
gone, the redundant non-colour cue is the *silhouette*: six deliberately different outlines
— pointed brilliant, tall oval, narrow step bar, rounded square, wide flat bar, circle —
which stay tellable apart as flat black shapes with the digits knocked out of them.
`tools/silhouette.html` is that check, at the sizes the app actually draws, magnified to
the real pixels; `GEM_NUMBER` in `src/ui/gems.js` is where each cut says how much of its
body a number may use. The digit's contrast is not left to the facet it lands on either:
it is stroked with the stone's own paired scrim colour under `paint-order: stroke`, so the
ink is only ever seen against that halo. The visible *words* are: the tiles print no
gemstone names, and no noble names either, because players recognise the stone and the
pips, not the label. Every `aria-label`, title and unavailable-button reason still gives
the real gemstone name, so what a screen reader hears did not change when the letter came
off the stone.

**Tokens and cards are one chip, and never look alike.** Spendable tokens ride on the
stone; the permanent card discount sits beside it in a little card — a bordered box with a
coloured spine, the same shape the opponent strip uses for a card count. One chip per
colour instead of a stone, a number and a badge. They mean very different things, so shape,
size and weight all separate them, and the accessible name says which is which in words
rather than leaning on any of that: "2 Sapphire tokens, 1 Sapphire card discount".

**Bots cannot cheat.** They are handed `redactFor(state, i)` — deck order stripped,
opponents' *blind-drawn* reserved cards hidden (see the reserving rules below). A bot
that wants to search calls `determinize()` to sample one plausible concrete world from
what it can actually see; it fills the still-hidden slots only and never re-rolls a card
that is already public.

## Rules implemented

On your turn, exactly one of:

- take 3 gems of different colours
- take 2 gems of one colour (only if that pile has 4+)
- buy a face-up card, or one you previously reserved
- reserve a card (face-up, or blind off the top of a deck) and take a gold

### Reserving, and who gets to see what

Reserving works two ways, and they differ in visibility — this is a real rule, not a
UI choice:

| How you reserved | Who can see it |
| --- | --- |
| Took a **face-up** card off the table | **Everyone.** The whole table watched you take it, so it stays public in your reserve for the rest of the game. |
| Drew the **top card of a deck** | **Only you.** You take it *"without showing it to the other players"*, so opponents see only that you hold a face-down card. |

Either way the card counts against your limit of 3 reserved cards, and either way you
get a gold if the bank has one.

It matters strategically: knowing an opponent is sitting on a specific 4-point card is
the difference between racing them and blocking them, while a face-down reserve tells
you only that they have *something*.

In the code, `Player.reserved` holds every reserved id and `Player.reservedBlind` holds
the subset drawn blind. `redactFor(state, i)` nulls out exactly the blind ids of the
*other* players, keeping the count visible; face-up reserves and your own hand are left
alone. The move log follows the same line — a face-up reserve names the card, a blind
one says only "the top card of tier 3, unseen".

In the UI, an opponent's panel shows their face-up reserves as full readable cards
(dashed edge and a "Reserved" flag, with the cost shown against *their* discounts so
you can see how close they are) and their blind reserves as a single face-down back
carrying a count.

Gold is wild. Cards give a permanent discount on their gem colour. Over 10 tokens at the
end of your turn and you return the excess. Meet a noble's card requirements and it comes
to you at end of turn — one per turn, and you choose when several qualify.

First to 15 points triggers the last round; everyone finishes with an equal number of
turns. Most points wins, ties broken by fewest cards bought.
