# VitaHub

Emulador de PS Vita (Vita3K) empacotado como app Android, com a interface
reescrita do zero (renderer/) e o APK montado por script, sem IDE.

## Rodar os testes (Termux, no proprio celular)

Os testes nao dependem de Android: sao Java puro.

```sh
pkg install openjdk-21
bash test/run.sh
```

Saida esperada: `51 passaram, 0 falharam`.

Cobre duas coisas:

- `PkgExtractor` — extracao de PKG. Rejeita TITLE_ID fora do formato, nome de
  entrada com `/` ou `..`, e CONTENT_ID malicioso, antes de gravar qualquer
  coisa em disco.
- `AppTree` — a ponte recursiva que apaga jogos. So aceita `ux0/app/<TITLE_ID>`
  com `sce_sys` (Vita) ou `pspemu/PSP/GAME/<ID>` com `EBOOT.PBP` (PSP).
  Qualquer outro caminho e recusado, para um caminho trocado nao apagar a
  arvore inteira.

## Montar o APK

Roda em Linux x86_64, nao em ARM (o `aapt2` e o `zipalign` so tem binario
x86_64/macOS/Windows).

Precisa de:

- Android SDK em `/opt/android-sdk`, com `platforms/android-34` e
  `build-tools/35.0.0`
- APK oficial do Vita3K em `/tmp/opencode/current_official.apk` — e dai que
  saem a `classes.dex` da engine, as libs nativas e os assets
- `VITAHUB_KEYPASS` no ambiente, para assinar (o `keystore.jks` e criado no
  primeiro build)

```sh
export VITAHUB_KEYPASS='...'
bash build.sh
```

A saida fica em `build/VitaHub.apk`.

## Onde o app guarda as coisas

| O que | Onde |
| --- | --- |
| `config.json` (ajustes do app) | `getFilesDir()` — interno, privado |
| `config.yml` (config da engine) | `getExternalFilesDir(null)` |
| Biblioteca de jogos | `installDir`, por padrao `.../files/vita` |
| Logs | `getExternalFilesDir(null)/vitahub.log` e `vita3k.log` |
| Firmware baixado | `<home>/fw/PSP2UPDAT.PUP` |

`installDir` pode apontar para um pendrive ou cartao SD. A troca de volume
reescreve o `pref-path` do `config.yml` e reinstala o firmware na arvore nova,
porque sem `vs0/sys` na pasta escolhida nenhum jogo abre.

## Login

O app nao tem senha nem formulario de login. Quem autentica na PSN e a engine,
dentro do ambiente emulado, pelo fluxo OAuth dos proprios apps do Vita. O host
guarda so um booleano (`psnSignedIn`) para a UI, e o `patchYaml` preserva
chaves desconhecidas — o estado de sessao da engine nao e apagado a cada boot.

`http-enable: true` liga o servidor HTTP local que a engine usa no fluxo de
autenticacao. Desligar quebra o login.
