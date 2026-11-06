#!/usr/bin/env bash
# 重新打包 Android APK（改完 index.html 后跑一遍即可）
set -e
ROOT=~/android-build/apk
DX=~/android-build/dx/usr/share/java/com.android.dx.jar
AJ=/usr/lib/android-sdk/platforms/android-23/android.jar
HERE="$(cd "$(dirname "$0")" && pwd)"

cp "$HERE/index.html" "$ROOT/assets/"
cd "$ROOT/build"
rm -rf classes classes.dex *.apk

javac -source 8 -target 8 -bootclasspath "$AJ" -encoding UTF-8 \
  -d classes "$ROOT/src/io/github/mrxie1109/xiangqi/MainActivity.java" 2>/dev/null

java -cp "$DX" com.android.dx.command.Main --dex --output=classes.dex classes
aapt package -f -M "$ROOT/AndroidManifest.xml" -S "$ROOT/res" -A "$ROOT/assets" -I "$AJ" -F base.apk
aapt add base.apk classes.dex >/dev/null
zipalign -f -p 4 base.apk aligned.apk
apksigner sign --ks "$ROOT/xiangqi.jks" --ks-pass pass:xiangqi2024 --key-pass pass:xiangqi2024 \
  --v1-signing-enabled true --v2-signing-enabled true --out "$ROOT/xiangqi.apk" aligned.apk

cp "$ROOT/xiangqi.apk" "$HERE/xiangqi.apk"
apksigner verify "$HERE/xiangqi.apk" && echo "OK: $HERE/xiangqi.apk ($(du -h "$HERE/xiangqi.apk" | cut -f1))"
