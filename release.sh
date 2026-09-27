#!/usr/bin/env bash
# Prepara uma release do VitaHub: builda, copia para o Download e imprime
# exatamente o que precisa ser publicado no GitHub.
#
# Existe por causa de um jeito silencioso de o atualizador nao funcionar: se a
# tag da release for menor ou igual a versao instalada, isNewer() retorna false
# e o app simplesmente nunca oferece update, sem mensagem. Aqui a tag sai do
# mesmo versionCode que o Android vai instalar, entao nao ha como divergir.
#
# O upload para o GitHub continua sendo manual (a API nao e acessivel do
# ambiente de build). Usage: bash release.sh
set -euo pipefail

cd "$(dirname "$0")"

MANIFEST_VERSION=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' AndroidManifest.xml | head -1)
: "${MANIFEST_VERSION:?nao achei android:versionCode no AndroidManifest.xml}"

UPD_CONF="$PWD/update.conf"
OWNER=""
REPO=""
if [ -f "$UPD_CONF" ]; then
  OWNER=$(sed -n 's/^OWNER=//p' "$UPD_CONF" | tr -d '[:space:]')
  REPO=$(sed -n 's/^REPO=//p' "$UPD_CONF" | tr -d '[:space:]')
fi

# O build.sh exige o keystore; sem isso a assinatura muda e o Android trata
# como outro app.
if [ -z "${VITAHUB_KEYPASS:-}" ] || [ -z "${VITAHUB_KEYSTORE:-}" ]; then
  echo "ERRO: defina VITAHUB_KEYPASS e VITAHUB_KEYSTORE antes de rodar." >&2
  exit 1
fi

echo "==> buildando v$MANIFEST_VERSION"
bash build.sh

APK_NAME="VitaHub-v${MANIFEST_VERSION}.apk"
DEST="${VITAHUB_DEST:-/storage/emulated/0/Download}"
mkdir -p "$DEST"
cp build/VitaHub.apk "$DEST/$APK_NAME"

echo
echo "=========================================================="
echo "  Release pronta: $APK_NAME"
echo "=========================================================="
echo "  arquivo ......... $DEST/$APK_NAME"
echo "  tamanho ......... $(du -h "$DEST/$APK_NAME" | cut -f1)"
echo "  tag ............. v$MANIFEST_VERSION   <- copie exatamente assim"
if [ -n "$OWNER" ] && [ -n "$REPO" ]; then
  echo "  pagina .......... https://github.com/$OWNER/$REPO/releases/new"
  echo
  echo "  IMPORTANTE: digite a tag como v$MANIFEST_VERSION, com o 'v'."
  echo "  O GitHub cria a tag do jeito que voce digitar, e o app compara a"
  echo "  tag com o versionCode. Sem o 'v' funciona, mas deixa a serie"
  echo "  inconsistente."
else
  echo "  (sem OWNER/REPO no update.conf: atualizador segue desligado)"
fi
echo
echo "  Ao publicar, arraste o arquivo acima como asset da release."
echo "  O app so procura asset com nome terminado em .apk."
