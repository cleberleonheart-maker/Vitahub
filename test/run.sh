#!/bin/bash
# Roda o harness do PkgExtractor (test/PkgTest.java) contra o codigo real.
#
# Existe porque a regra "chave errada bloqueia, chave certa conclui" nao da
# para conferir pela UI: ela precisa de um PKG cifrado de verdade, e o
# comportamento errado (instalar pela metade e reportar sucesso) era
# silencioso. O harness monta um PFS valido, assina a licencia com a chave
# certa e com uma errada, e verifica que nada e gravado antes da recusa.
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="${VITAHUB_TEST_WORK:-/tmp/vitahub-pkgtest}"
CLASSES=$(mktemp -d)
trap 'rm -rf "$CLASSES"' EXIT

echo "==> compila PkgExtractor"
javac -nowarn -d "$CLASSES" src/com/vitahub/app/PkgExtractor.java src/com/vitahub/app/AppTree.java

echo "==> compila e roda o harness"
javac -nowarn -cp "$CLASSES" -d "$CLASSES" test/PkgTest.java
java -cp "$CLASSES" -Dvitahub.test.work="$WORK" PkgTest

# A varredura e a migracao rodam so dentro do WebView do Android, entao nenhuma
# das suites acima as tocava. Erro de contagem ali e indistinguivel de "nada
# instalado" para quem ve a tela, e descobrir um custava um APK por tentativa --
# o mesmo defeito chegou a custar cinco.
echo "==> varredura da biblioteca (ponte falsa, sem aparelho)"
node test/scan.js
echo "==> migracao da pasta antiga (ponte falsa, sem aparelho)"
node test/migrate.js
echo "==> migracao para a pasta compartilhada (ponte falsa, sem aparelho)"
node test/shared.js

echo "==> fiação do renderer"
node test/wiring.js
