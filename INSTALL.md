# Installing Saffron Road

How to get the game onto a phone, and how to build it yourself. For what the
game is and how to play, see [README.md](README.md); for working on it, see
[DEVELOPING.md](DEVELOPING.md).

## Just install it

Download the APK from the [latest release](https://github.com/joebywan/saffron-road/releases/latest)
on the phone itself, then tap it. Android will ask you to allow installs from
whatever downloaded it — a browser, a file manager — because the app does not come
from a store. Allow it, and the install proceeds like any other.

Every release is signed with the same key, so each one installs straight over the
one before it. You never need to uninstall first.

The rest of this document is for building it yourself, or for playing without
installing anything.

## Other ways to play

Three routes, and they are **not** equivalent — which is the part that trips people up.

| | Real app icon | Works offline | Needs a server or a host |
| --- | --- | --- | --- |
| **Android APK** — `android/` | yes | yes | **no** |
| PWA installed from an https host | yes | yes | an https host |
| `http://192.168.x.x:8123` over wifi | no | no | a laptop on the same wifi |

On Android the APK is the one to reach for. Everything else on this list exists because
browsers make you earn an install; the APK just *is* an app.

### Path 1 — build the Android app yourself

You do not need this to play; the release above is the same APK. This is for
changing the game and running your own build.

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

The launcher icon is the app's own crocus mark, drawn by `tools/icons.js` — the same
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
LAN addresses are plain http, so no install and no offline there.
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

