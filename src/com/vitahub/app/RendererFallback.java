package com.vitahub.app;

import android.app.Activity;
import android.os.SystemClock;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;

/**
 * Troca OpenGL por Vulkan quando o OpenGL presentations falha.
 *
 * <p>Situacao medida nesta Mali-G52: com OpenGL o jogo carrega, a sessao
 * nativa sobe, o processo fica vivo — e a tela fica preta. Nada falha de
 * forma visivel, entao nada volta erro. A unica evidencia e a engine
 * repetindo {@code Failed to initialise color surface texture} milhares de
 * vezes. Como o default do app ja e Vulkan, so chega aqui quem escolheu
 * OpenGL de proposito; mesmo assim a escolha produz tela preta, e refazer a
 * mesma configuracao a cada sessao e desperdicio.
 *
 * <p>Regras deliberadas:
 * <ul>
 *   <li>Nunca o inverso. So OpenGL -&gt; Vulkan, nunca Vulkan -&gt; OpenGL:
 *       se o Vulkan falhar, trocar de renderer esconderia a causa em vez de
 *       resolve-la.</li>
 *   <li>Uma vez por processo. Sem isso dois watchers se provocariam num laco
 *       de relancamento.</li>
 *   <li>Somente durante o boot. O erro procurado e de apresentacao e surge
 *       nos primeiros segundos; um erro igual muito depois e outra coisa e
 *       nao deve trocar o renderer do usuario.</li>
 *   <li>Silencioso para o motor, explicito para o log. A troca e gravada no
 *       config.json, entao e permanente e o usuario nao volta a cair nela.</li>
 * </ul>
 */
final class RendererFallback {

    /** Assinatura observada no log da engine quando o OpenGL nao apresenta. */
    private static final String SIGNATURE = "Failed to initialise color surface texture";

    private static final long WATCH_MS = 45000L;
    private static final long POLL_MS = 1500L;
    private static final int TAIL_BYTES = 96 * 1024;

    /** Uma vez por processo: o relancamento recria a Activity, nao o processo. */
    private static boolean fired;

    private RendererFallback() {
    }

    static void watch(final EngineActivity act) {
        if (fired) return;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    runWatch(act);
                } catch (Throwable e) {
                    AppLog.e("RendererFallback: falhou", e);
                }
            }
        }, "vitahub-renderer-fallback");
        t.setDaemon(true);
        t.start();
    }

    private static void runWatch(EngineActivity act) throws Exception {
        File cfg = new File(act.getFilesDir(), "config.json");
        if (!cfg.isFile()) return;

        // So OpenGL interessa: qualquer outro valor ja e o bom, e o default do
        // app ja e Vulkan.
        if (!"opengl".equalsIgnoreCase(currentRenderer(cfg))) {
            AppLog.step("RendererFallback: renderer nao e OpenGL, nada a fazer");
            return;
        }
        AppLog.step("RendererFallback: OpenGL selecionado, vigiando apresentacao por "
                + (WATCH_MS / 1000) + "s");

        File log = new File(act.getExternalFilesDir(null), "vita3k.log");
        long start = SystemClock.elapsedRealtime();
        long from = log.isFile() ? log.length() : 0L;

        while (SystemClock.elapsedRealtime() - start < WATCH_MS) {
            if (act.isFinishing()) return;
            Thread.sleep(POLL_MS);
            if (act.isFinishing()) return;
            if (!log.isFile()) continue;
            // Cresce: o log so cresce nesta sessao, entao a posicao inicial
            // descarta o ruido de boot anteriores.
            String tail = readFrom(log, from);
            if (tail.indexOf(SIGNATURE) < 0) continue;

            AppLog.step("RendererFallback: apresentacao OpenGL falhou no log da engine, "
                    + "trocando para Vulkan");
            if (!setRenderer(cfg, "Vulkan")) {
                AppLog.step("RendererFallback: nao consegui gravar o renderer em config.json");
                return;
            }
            if (fired) return;
            fired = true;
            act.relaunchSession("fallback-opengl-para-vulkan");
            return;
        }
        AppLog.step("RendererFallback: OpenGL sem erro de apresentacao, mantido");
    }

    private static String currentRenderer(File cfg) {
        try {
            byte[] b = readAll(cfg, 256 * 1024);
            if (b == null) return "";
            JSONObject root = new JSONObject(new String(b, "UTF-8"));
            JSONObject s = root.optJSONObject("settings");
            return s == null ? "" : s.optString("renderer", "");
        } catch (Throwable t) {
            return "";
        }
    }

    /** Reescreve so settings.renderer, preservando todo o resto do arquivo. */
    private static boolean setRenderer(File cfg, String value) {
        FileInputStream in = null;
        FileOutputStream out = null;
        try {
            byte[] b = readAll(cfg, 1024 * 1024);
            if (b == null) return false;
            JSONObject root = new JSONObject(new String(b, "UTF-8"));
            JSONObject s = root.optJSONObject("settings");
            if (s == null) {
                s = new JSONObject();
                root.put("settings", s);
            }
            s.put("renderer", value);
            // Mesma forma que o JS grava (JSON.stringify(cfg, null, 2)).
            String body = root.toString(2);
            out = new FileOutputStream(cfg, false);
            out.write(body.getBytes("UTF-8"));
            out.flush();
            return true;
        } catch (Throwable t) {
            AppLog.e("RendererFallback: falha ao gravar config.json", t);
            return false;
        } finally {
            close(in);
            close(out);
        }
    }

    private static String readFrom(File f, long from) {
        RandomAccessFile raf = null;
        try {
            long len = f.length();
            if (len <= from) return "";
            if (len - from > TAIL_BYTES) from = len - TAIL_BYTES;
            raf = new RandomAccessFile(f, "r");
            raf.seek(from);
            byte[] b = new byte[(int) (len - from)];
            raf.readFully(b);
            return new String(b, 0, b.length, "UTF-8");
        } catch (Throwable t) {
            return "";
        } finally {
            close(raf);
        }
    }

    private static byte[] readAll(File f, int cap) {
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && bo.size() < cap) bo.write(buf, 0, n);
            return bo.toByteArray();
        } catch (Throwable t) {
            return null;
        } finally {
            close(in);
        }
    }

    private static void close(java.io.Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (Throwable ignore) {
        }
    }
}
