package com.vitahub.app;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Log em arquivo das duas Ativities.
 *
 * <p>Motivo: o logcat deste aparelho e inviavel para diagnostico. O daemon
 * {@code misight} (MIUI) despeja milhares de linhas por segundo e rotaciona os
 * buffers antes que qualquer coisa da app seja lida. Como o sintoma relatado e
 * "o app fecha" (o processo morre, entao nao ha ultimo log), o arquivo
 * <code>vitahub.log</code> em getExternalFilesDir(null) sobrevive a morte do
 * processo e a rotacao do logcat, e permite ler o que aconteceu ate o fim.
 */
public final class AppLog {

    private static final String TAG = "VitaHub";
    private static final String FILE = "vitahub.log";
    private static final long MAX_BYTES = 512L * 1024;
    private static final SimpleDateFormat FMT =
            new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);

    private static File dir;
    private static Context appCtx;

    private AppLog() {
    }

    static void init(Context ctx) {
        if (appCtx == null && ctx != null) appCtx = ctx.getApplicationContext();
        if (dir == null && ctx != null) {
            try {
                dir = ctx.getExternalFilesDir(null);
            } catch (Throwable ignore) {
            }
        }
    }

    static File file() {
        if (dir == null) return null;
        return new File(dir, FILE);
    }

    static void i(String msg) {
        write("I", msg, null);
    }

    static void w(String msg) {
        write("W", msg, null);
    }

    public static void e(String msg, Throwable t) {
        write("E", msg, t);
    }

    /** Linha de breadcrumb: o usuario le o arquivo e reconstroi a sequencia. */
    public static void step(String msg) {
        write("S", msg, null);
    }

    private static void write(String lvl, String msg, Throwable t) {
        String line = FMT.format(new Date()) + " " + lvl + " " + msg;
        if (t != null) {
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            line = line + " | " + sw.toString().replace("\n", " \\n ");
        }
        if ("E".equals(lvl)) {
            Log.e(TAG, msg, t);
        } else if ("W".equals(lvl)) {
            Log.w(TAG, msg);
        } else {
            Log.i(TAG, msg);
        }
        append(line);
    }

    private static synchronized void append(String line) {
        appendTo(file(), line);
        appendTo(publicMirror(), line);
    }

    /**
     * Copia do log no armazenamento compartilhado.
     *
     * <p>Existe por causa do Android/data: o MIUI nega a leitura de
     * /Android/data para qualquer processo que nao seja o proprio app, entao o
     * vitahub.log acima fica inacessivel para quem precisa diagnosticar (sem
     * adb, sem root de verdade). Espelhando no Download, que qualquer app com
     * "acesso a todos os arquivos" consegue escrever, o mesmo texto fica
     * legivel por gerenciador de arquivo e por leitura direta.
     *
     * <p>Sem a concessao a escrita falha e e descartada em silencio: o espelho
     * e um extra, nunca o destino unico, para nao perder o log principal.
     */
    private static File publicMirror() {
        if (appCtx == null) return null;
        try {
            if (android.os.Build.VERSION.SDK_INT < 30
                    || !android.os.Environment.isExternalStorageManager()) {
                return null;
            }
            File sd = android.os.Environment.getExternalStorageDirectory();
            if (sd == null) return null;
            File d = new File(sd, "Download");
            if (!d.isDirectory() && !d.mkdirs()) return null;
            return new File(d, FILE);
        } catch (Throwable ignore) {
            return null;
        }
    }

    private static void appendTo(File f, String line) {
        if (f == null) return;
        try {
            if (f.exists() && f.length() > MAX_BYTES) {
                // Rotaciona sozinho: mantem a ultima metade do historico.
                File old = new File(f.getParentFile(), FILE + ".1");
                if (old.exists() && !old.delete()) return;
                if (!f.renameTo(old)) return;
            }
            FileOutputStream out = new FileOutputStream(f, true);
            try {
                out.write((line + "\n").getBytes("UTF-8"));
            } finally {
                out.close();
            }
        } catch (Throwable ignore) {
        }
    }
}
