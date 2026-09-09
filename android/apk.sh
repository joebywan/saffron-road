#!/usr/bin/env bash
#
# Builds the sideloadable APK, end to end, from a clean checkout.
#
#   npm run apk          (from the repo root)
#   android/apk.sh
#
# It does two small chores that would otherwise be a README paragraph each:
# finding the Android SDK, and picking a JDK that Gradle will actually run on.
# Everything else is `./gradlew assembleDebug`.
#
# THE JDK RANGE IS NOT ARBITRARY. The Android Gradle Plugin has needed at
# least 17 since AGP 8.0 and still does at 9.4, and Gradle refuses to start
# on a Java newer than the one its version knows about. Gradle 9.7 raised
# that ceiling well past where 8.14 left it, so the range moved with it.
# A machine whose default `java` is newer still builds fine — this script
# just points JAVA_HOME at a JDK in range instead of failing three minutes in
# with a message about class file major versions.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf '%s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- SDK ------

if [ -z "${ANDROID_HOME:-}" ] && [ -n "${ANDROID_SDK_ROOT:-}" ]; then
  ANDROID_HOME="$ANDROID_SDK_ROOT"
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  for candidate in "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" /usr/lib/android-sdk; do
    if [ -d "$candidate/platforms" ]; then ANDROID_HOME="$candidate"; break; fi
  done
fi
[ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/platforms" ] || die \
"No Android SDK found.

Set ANDROID_HOME, or install one — see the 'One-time SDK setup' section of
the README. Looked at: \$ANDROID_HOME, \$ANDROID_SDK_ROOT, ~/Android/Sdk,
~/Library/Android/sdk, /usr/lib/android-sdk."
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# ---------------------------------------------------------------- JDK ------

# Major version of a JDK home, or nothing if it is not one.
jdk_major() {
  local home="$1" v=""
  [ -x "$home/bin/javac" ] || return 1
  if [ -r "$home/release" ]; then
    v="$(sed -n 's/^JAVA_VERSION="\{0,1\}\([0-9][0-9]*\).*/\1/p' "$home/release" | head -1)"
  fi
  [ -n "$v" ] || v="$("$home/bin/java" -version 2>&1 |
    sed -n '1s/.*"\([0-9][0-9]*\).*/\1/p' | head -1)"
  [ -n "$v" ] || return 1
  printf '%s' "$v"
}

usable() {
  local v
  v="$(jdk_major "$1")" || return 1
  [ "$v" -ge 17 ] && [ "$v" -le 25 ]
}

if [ -n "${JAVA_HOME:-}" ] && usable "$JAVA_HOME"; then
  : # whatever the caller set is fine
else
  found=""
  for home in \
      /usr/lib/jvm/* \
      /usr/java/* \
      /Library/Java/JavaVirtualMachines/*/Contents/Home \
      "$HOME/.sdkman/candidates/java"/* \
      "$HOME/.jdks"/*; do
    if [ -d "$home" ] && usable "$home"; then found="$home"; break; fi
  done
  [ -n "$found" ] || die \
"No JDK between 17 and 25 found, and the Android build will not run on anything else.

Install one (\`sudo apt install openjdk-21-jdk\`, or Temurin) and either put it
on JAVA_HOME or leave it somewhere under /usr/lib/jvm."
  JAVA_HOME="$found"
fi
export JAVA_HOME

# -------------------------------------------------------------- build ------

echo "SDK:  $ANDROID_HOME"
echo "JDK:  $JAVA_HOME (Java $(jdk_major "$JAVA_HOME"))"
echo

# THE VERSION. app/build.gradle derives versionName/versionCode (and the
# service worker's version) from -PappVersion, falling back to the git tag and
# then to 0.0.0-dev. SAFFRON_VERSION is the way to set it from a script
# without remembering the property name:
#
#   SAFFRON_VERSION=1.3.0 npm run apk
#
# Nothing is hardcoded, because a hardcoded versionCode is what made four
# releases in a row look identical to Android and install as no-ops.
gradle_args=("${@:-assembleDebug}")
if [ -n "${SAFFRON_VERSION:-}" ]; then
  gradle_args+=("-PappVersion=$SAFFRON_VERSION")
fi

"$here/gradlew" -p "$here" "${gradle_args[@]}"

apk="$here/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$apk" ]; then
  echo
  echo "APK: $apk"
  echo "     $(du -h "$apk" | cut -f1)"
  # What Android will actually compare on the next install. Printed because
  # "the new build did nothing" is what a stuck versionCode looks like from
  # the outside, and this is the one line that would have shown it.
  badging="$(ls -d "$ANDROID_HOME"/build-tools/*/aapt2 2>/dev/null | tail -1)"
  if [ -n "$badging" ]; then
    "$badging" dump badging "$apk" 2>/dev/null | sed -n '1s/^package: //p' | sed 's/^/     /'
  fi
  sw="$(unzip -p "$apk" assets/sw.js 2>/dev/null |
        sed -n "s/^const INJECTED_VERSION = '\(.*\)';.*/\1/p")"
  [ -n "$sw" ] && echo "     service worker version: $sw"
  echo
  echo "Install it with:  adb install -r \"$apk\""
fi
