#!/bin/bash
# Build VitaHub.apk (hand-rolled: aapt2 + javac + d8 + zipalign + apksigner)
set -euo pipefail
cd "$(dirname "$0")"

# O SDK pode estar em /opt/android-sdk (imagem de build) ou no home, de onde
# foi instalado na mao. O primeiro achado vence; os dois caminhos sao
# sobrescritos pelo ambiente se preciso.
SDK=""
for cand in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" /opt/android-sdk "$HOME/android-sdk"; do
  if [ -n "$cand" ] && [ -d "$cand/platforms" ] && [ -d "$cand/build-tools" ]; then
    SDK="$cand"
    break
  fi
done
: "${SDK:?nao achei o Android SDK (use ANDROID_HOME ou ANDROID_SDK_ROOT)}"
AJ="$SDK/platforms/android-34/android.jar"

# Nao crava a versao do build-tools: os binarios oficiais sao x86_64 e
# derrubam com "Illegal instruction" em maquinas ARM. Testa do mais novo
# para o mais antigo e fica com o primeiro que realmente responder.
BT=""
for cand in "$SDK"/build-tools/37.0.0 "$SDK"/build-tools/36.0.0 \
            "$SDK"/build-tools/35.0.0 "$SDK"/build-tools/34.0.0 \
            "$SDK"/build-tools/33.0.1; do
  if [ -x "$cand/aapt2" ] && "$cand/aapt2" version >/dev/null 2>&1; then
    BT="$cand"
    break
  fi
done
: "${BT:?nenhum build-tools com aapt2 executavel em $SDK}"
# aapt2/d8/zipalign/apksigner vivem em build-tools; sem isso o script
# depende de o PATH da maquina ja estar configurado.
export PATH="$BT:$PATH"
OUT="$PWD/build"
SRC="$PWD/src"
# O renderer (interface do app) mora neste repo, em renderer/. A copia local
# em /root/VitaHub/renderer continua valendo como fallback para quem develope
# fora do repo, mas a fonte de verdade versionada e a daqui: sem isso o botao
# "Finalizar" e o resto da UI so existiriam dentro do APK, sem git.
RENDER="$PWD/renderer"
[ -d "$RENDER" ] || RENDER=/root/VitaHub/renderer
# De onde vem a engine (classes2.dex, libVita3K.so, shaders, gui-configs).
# Aceita o APK oficial do Vita3K ou um APK ja montado deste app: nos dois
# casos a engine e a mesma, e no segundo o .dex chama-se classes2.dex. Isso
# importa porque o APK oficial nem sempre esta a mao, e um APK do proprio app
# sempre esta.
ENGINE_APK="${VITAHUB_ENGINE_APK:-/tmp/opencode/current_official.apk}"

KS="${VITAHUB_KEYSTORE:-$PWD/keystore.jks}"
# A senha da chave de assinatura nao fica no fonte: quem assina este APK pode
# publicar um "update" que o Android aceita como legitimo. Vem do ambiente
# (VITAHUB_KEYPASS) e o keystore e gitignored.
KEYPASS="${VITAHUB_KEYPASS:?defina VITAHUB_KEYPASS com a senha do keystore.jks}"

# Guarda de versao: sem versionCode maior que o do APK ja instalado, o
# Android recusa a atualizacao ("INSTALL_FAILED_VERSION_DOWNGRADE") e parece
# que o problema e a assinatura, quando nao e.
MANIFEST_VERSION=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' AndroidManifest.xml | head -1)
: "${MANIFEST_VERSION:?nao achei android:versionCode no AndroidManifest.xml}"
PREV="$OUT/VitaHub.apk"
if [ -f "$PREV" ]; then
  PREV_VERSION=$(aapt2 dump badging "$PREV" 2>/dev/null | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
  if [ -n "$PREV_VERSION" ] && [ "$MANIFEST_VERSION" -le "$PREV_VERSION" ]; then
    echo "ERRO: versionCode do manifesto ($MANIFEST_VERSION) <= build anterior ($PREV_VERSION)."
    echo "      O Android vai recusar a instalacao por cima. Suba android:versionCode."
    exit 1
  fi
fi
echo "==> versionCode: $MANIFEST_VERSION"
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen" "$OUT/assets" "$OUT/dex" "$OUT/stubs-classes"

echo "==> assets (renderer)"
cp -r "$RENDER"/. "$OUT/assets/"

# Update checker: owner/repo/URL base da API entram aqui, para nao ficar
# hardcoded no fonte. Sem OWNER (ou sem API_BASE) no update.conf os
# placeholders permanecem e o app so mostra "sem repositorio de updates"
# (build local continua funcionando).
UPD_CONF="$PWD/update.conf"
UPD_OWNER=""
UPD_REPO="VitaHub"
UPD_API_BASE=""
if [ -f "$UPD_CONF" ]; then
  UPD_OWNER=$(sed -n 's/^OWNER=//p' "$UPD_CONF" | tr -d '[:space:]')
  UPD_REPO=$(sed -n 's/^REPO=//p' "$UPD_CONF" | tr -d '[:space:]')
  UPD_API_BASE=$(sed -n 's#^API_BASE=##p' "$UPD_CONF" | tr -d '[:space:]')
  [ -z "$UPD_REPO" ] && UPD_REPO="VitaHub"
fi
if [ -n "$UPD_OWNER" ] && [ -n "$UPD_API_BASE" ]; then
  sed -i "s/__VitaHub_UPDATE_OWNER__/$UPD_OWNER/g; s/const UPDATE_REPO = 'VitaHub';/const UPDATE_REPO = '$UPD_REPO'/; s#__VitaHub_UPDATE_API_BASE__#$UPD_API_BASE#g" \
    "$OUT/assets/js/vitahub_android.js"
  echo "    update repo: $UPD_OWNER/$UPD_REPO ($UPD_API_BASE)"
else
  echo "    update repo: (nao configurado - OWNER ou API_BASE vazio em update.conf)"
fi

echo "==> assets (config.yml template da engine)"
mkdir -p "$OUT/assets/templates"
cp "$PWD/src/templates/config.yml" "$OUT/assets/templates/config.yml"

echo "==> assets (engine usu)"
python3 - "$ENGINE_APK" "$OUT/assets" <<'EOF'
import sys, zipfile, os
apk, dest = sys.argv[1], sys.argv[2]
# O APK de origem pode ser o oficial do Vita3K (so tem assets de engine) ou
# um APK ja montado deste app, que carrega o renderer inteiro junto. Copiar
# tudo as cegas sobrescreveria o renderer recem-gerado em $OUT/assets com a
# versao antiga -- que e como o rename para VitaHub e as correcoes de
# seguranca voltariam sem ninguem notar. Por isso o que pertence ao host e
# descartado explicitamente e o que sobra e conferido.
HOST_PREFIXES = ('index.html', 'js/', 'css/', 'brand/', 'dexopt/', 'templates/')
copied = skipped = 0
with zipfile.ZipFile(apk) as z:
    for n in z.namelist():
        if not n.startswith('assets/') or n == 'assets/':
            continue
        rel = os.path.relpath(n, 'assets')
        if rel.startswith(HOST_PREFIXES):
            skipped += 1
            continue
        t = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(t), exist_ok=True)
        with open(t, 'wb') as f:
            f.write(z.read(n))
        copied += 1
if copied == 0:
    sys.exit('nenhum asset de engine encontrado em %s' % apk)
print('assets engine ok: %d copiados, %d do host descartados' % (copied, skipped))
EOF

echo "==> icons"
# A marca vem do genbrand.py (gerada do zero, sem pegar arte pronta de
# nenhum Vita3K). Rodar o antigo makeicon.py aqui sobrescrevia o
# ic_launcher.png com um placeholder de tela+bolhas a cada build, e era
# exatamente por isso que o icone do launcher nunca mudava.
# O gerador leva ~6 min, entao so roda de verdade quando os arquivos
# faltam ou quando VITAHUB_REGEN_BRAND=1.
if [ "${VITAHUB_REGEN_BRAND:-0}" = "1" ]; then
    python3 "$PWD/genbrand.py"
elif [ ! -f "$PWD/res/mipmap-xhdpi/ic_launcher.png" ] \
  || [ ! -f "$PWD/res/mipmap-xhdpi/ic_launcher_foreground.png" ] \
  || [ ! -f "$PWD/res/drawable-nodpi/vitahub_mark.png" ] \
  || [ ! -f "$RENDER/brand/vitahub-mark.png" ] \
  || [ ! -f "$RENDER/brand/boot.wav" ]; then
    echo "    arte ausente, gerando"
    python3 "$PWD/genbrand.py"
else
    echo "    arte ja gerada (VITAHUB_REGEN_BRAND=1 para refazer)"
fi

echo "==> build-tools: $(basename "$BT")"
echo "==> aapt2 compile"
aapt2 compile --dir "$PWD/res" -o "$OUT/res.zip"

echo "==> aapt2 link"
aapt2 link -o "$OUT/app.raw.apk" \
  -I "$AJ" \
  -R "$OUT/res.zip" \
  --manifest "$PWD/AndroidManifest.xml" \
  --java "$OUT/gen" \
  -A "$OUT/assets" \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  --auto-add-overlay

echo "==> libs nativas"
python3 - "$ENGINE_APK" "$OUT" <<'EOF'
import sys, zipfile, os
apk, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk) as z:
    for n in z.namelist():
        if n.startswith('lib/') and n.endswith('.so'):
            t = os.path.join(out, n)
            os.makedirs(os.path.dirname(t), exist_ok=True)
            with open(t, 'wb') as f:
                f.write(z.read(n))
print('libs extraidas')
EOF

echo "==> javac (stubs de compilacao)"
find "$PWD/engine-stubs" -name '*.java' > "$OUT/stubs.txt"
javac -source 8 -target 8 -bootclasspath "$AJ" \
  -d "$OUT/stubs-classes" @"$OUT/stubs.txt"

echo "==> javac (app)"
find "$SRC" -name '*.java' > "$OUT/sources.txt"
javac -source 8 -target 8 -bootclasspath "$AJ" \
  -cp "$OUT/stubs-classes" \
  -d "$OUT/classes" @"$OUT/sources.txt" "$OUT/gen/com/vitahub/app/R.java"

echo "==> d8 (app)"
"$BT/d8" --lib "$AJ" --classpath "$OUT/stubs-classes" --release --min-api 26 \
  --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

echo "==> classes2.dex (engine)"
python3 - "$ENGINE_APK" "$OUT/dex" <<'EOF'
import sys, zipfile, os
apk, dex_dir = sys.argv[1], sys.argv[2]
# Num APK oficial do Vita3K a engine e o classes.dex. Num APK ja montado
# deste app, a engine ja e o classes2.dex e o classes.dex e o codigo do
# host -- que e descartado e recompilado a partir de src/. Ler sempre o
# classes.dex empacotaria o host velho junto com o novo.
with zipfile.ZipFile(apk) as z:
    names = set(z.namelist())
    for cand in ('classes2.dex', 'classes.dex'):
        if cand in names:
            with open(os.path.join(dex_dir, 'classes2.dex'), 'wb') as f:
                f.write(z.read(cand))
            print('engine dex: %s' % cand)
            break
    else:
        sys.exit('nenhuma classes*.dex de engine em %s' % apk)
EOF

echo "==> package dex"
(cd "$OUT/dex" && zip -q "../app.raw.apk" classes.dex classes2.dex)

echo "==> package libs"
(cd "$OUT" && zip -q -y -r app.raw.apk lib)

echo "==> zipalign"
zipalign -f 4 "$OUT/app.raw.apk" "$OUT/app.align.apk"

echo "==> keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias vitahub -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$KEYPASS" -keypass "$KEYPASS" \
    -dname "CN=VitaHub,O=VitaHub,C=BR" -noprompt
fi

echo "==> apksigner"
apksigner sign --ks "$KS" --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" \
  --out "$OUT/VitaHub.apk" "$OUT/app.align.apk"

echo "==> OK"
ls -lh "$OUT/VitaHub.apk"