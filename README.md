# Vitahub

APK do VitaHub para Android.

Este repositório hospeda as releases. O app verifica atualizações por conta
própria em **Configurações → Sobre → Verificar agora**.

## Como publicar

```bash
VITAHUB_KEYPASS=... VITAHUB_KEYSTORE=... bash release.sh
```

O script builda, copia o APK para o Download e imprime a tag exata a ser
publicada. A tag sai do mesmo `versionCode` que o Android instala, porque o
app compara a tag com o `versionCode` — tag divergente faz o atualizador
falhar em silêncio.

## Convenção de nomes

- tag: `vNN`, onde `NN` é o `android:versionCode` do `AndroidManifest.xml`
- asset: `VitaHub-vNN.apk` (o app procura o primeiro asset terminado em `.apk`)
