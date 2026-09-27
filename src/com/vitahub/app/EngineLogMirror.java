package com.vitahub.app;

import android.content.Context;
import android.os.Build;
import android.os.Environment;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * Espelha o log da engine (vita3k.log) no armazenamento compartilhado.
 *
 * <p>A engine escreve o proprio log na pasta externa do app. Esse caminho e
 * bloqueado para leitura fora do app pelo MIUI, e o sintoma atual — "tela
 * preta" — nao deixa nenhum rastro no log do host, porque nada falha: a
 * sessao nativa sobe e o jogo roda. O log da engine e o unico lugar que
 * explica o que o emulador esta fazendo com Vulkan, swapchain e primeiro
 * quadro.
 *
 * <p>A copia roda num thread separado a cada poucos segundos, e nao so no fim
 * da Activity: um crash nativo mata o processo antes de qualquer callback, e
 * uma copia feita antes da morte e a unica forma de ficar com ele.
 */
final class EngineLogMirror {

    private static final String SRC = "vita3k.log";
    private static final String DST = "vita3k.log";
    private static final long MAX_TAIL = 512L * 1024;

    private static Thread worker;
    private static volatile boolean running;

    private EngineLogMirror() {
    }

    static synchronized void start(final Context ctx) {
        if (worker != null) return;
        final Context app = ctx.getApplicationContext();
        running = true;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                while (running) {
                    try {
                        copyOnce(app);
                    } catch (Throwable ignore) {
                    }
                    try {
                        Thread.sleep(2000L);
                    } catch (InterruptedException stop) {
                        return;
                    }
                }
            }
        }, "vitahub-log-mirror");
        t.setDaemon(true);
        worker = t;
        t.start();
    }

    static synchronized void stop() {
        running = false;
        worker = null;
    }

    private static void copyOnce(Context ctx) {
        if (!permitted()) return;
        File src = new File(ctx.getExternalFilesDir(null), SRC);
        if (!src.isFile() || src.length() == 0) return;

        File sd = Environment.getExternalStorageDirectory();
        if (sd == null) return;
        File dir = new File(sd, "Download");
        if (!dir.isDirectory() && !dir.mkdirs()) return;
        File dst = new File(dir, DST);

        long len = src.length();
        long from = Math.max(0, len - MAX_TAIL);
        FileInputStream in = null;
        FileOutputStream out = null;
        try {
            in = new FileInputStream(src);
            if (from > 0) in.skip(from);
            out = new FileOutputStream(dst, false);
            byte[] buf = new byte[16384];
            int r;
            while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        } catch (Throwable ignore) {
            // Sem log espelhado nao ha nada a fazer: e acessorio, o log do
            // host continua valendo.
        } finally {
            close(in);
            close(out);
        }
    }

    private static void close(java.io.Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (Throwable ignore) {
        }
    }

    private static boolean permitted() {
        try {
            return Build.VERSION.SDK_INT < 30 || Environment.isExternalStorageManager();
        } catch (Throwable t) {
            return false;
        }
    }
}
