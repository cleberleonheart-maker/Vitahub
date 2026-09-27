package com.vitahub.app;

import java.io.File;

/**
 * Regra que decide se um caminho pode ser tratado como "um app instalado" e,
 * portanto, apagado pela bridge.
 *
 * <p>Fica numa classe sem dependencia de Android de proposito: e a unica
 * protecao contra apagamento acidental, entao precisa ser testavel sem
 * aparelho. O harness compila este arquivo junto com o PkgExtractor.
 */
public final class AppTree {

    private AppTree() {
    }

    /**
     * @return null quando o alvo pode ser apagado, ou o motivo da recusa.
     */
    public static String notAnInstalledApp(File d) {
        if (d == null) return "caminho nulo";
        if (!d.isDirectory()) return "nao e pasta";
        File parent = d.getParentFile();
        if (parent == null) return "sem pasta pai";
        String pc;
        try {
            pc = parent.getCanonicalPath();
        } catch (Exception e) {
            return "caminho invalido";
        }
        // A biblioteca tem DUAS arvores e ambas sao alvo legitimo de apagar:
        //
        //   vita/ux0/app/<TITLE_ID>          (Vita, marcador sce_sys)
        //   vita/pspemu/PSP/GAME/<ID>        (PSP/homebrew, marcador EBOOT.PBP)
        //
        // Checar so a primeira deixava o usuario sem como apagar um jogo de
        // PSP: a pasta nem tem sce_sys e o aviso de "recusado" aparecia em um
        // jogo legitimate, fazendo a protecao parecer quebrada.
        String sep = File.separator;
        if (pc.endsWith(sep + "ux0" + sep + "app")) {
            if (!new File(d, "sce_sys").isDirectory()) return "sem sce_sys";
            return null;
        }
        if (pc.endsWith(sep + "pspemu" + sep + "PSP" + sep + "GAME")) {
            if (!new File(d, "EBOOT.PBP").isFile()) return "sem EBOOT.PBP";
            return null;
        }
        // Fora das duas arvores: raiz da arvore, ux0 inteiro, pspemu inteiro, o
        // volume do pendrive, a pasta de save. Nada disso pode ser apagado
        // "como se fosse um jogo".
        return "fora de ux0/app e pspemu/PSP/GAME";
    }
}
