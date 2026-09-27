package com.vitahub.app;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Gravador de crash legivel de fora do app.
 *
 * Sem isto, um crash so aparece como "o app fecha" na tela: o stack trace vai
 * pro logcat, que nao da para ler sem adb, e o vitahub.log fica preso em
 * Android/data, que o MIUI bloqueia. Aqui a excecao vai tambem para um arquivo
 * no Download, que da para abrir pelo gerenciador do celular e ler por adb.
 *
 * O caminho do Download e usado em vez de getExternalFilesDir porque o app ja
 * pede MANAGE_EXTERNAL_STORAGE e precisa dele para ler os .pkg do usuario.
 */
final class CrashLog {

    private static final String TAG = "VitaHub";
    private static final String FILE = "vitahub-crash.log";
    private static final long MAX_BYTES = 256L * 1024;
    private static final SimpleDateFormat FMT =
            new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);

    private CrashLog() {
    }

    static void install(Context ctx) {
        final Context app = ctx.getApplicationContext();
        final Thread.UncaughtExceptionHandler prev =
                Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    write(app, t, e);
                } catch (Throwable ignore) {
                }
                if (prev != null) prev.uncaughtException(t, e);
                else {
                    android.os.Process.killProcess(android.os.Process.myPid());
                    System.exit(10);
                }
            }
        });
    }

    private static void write(Context ctx, Thread t, Throwable e) {
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        pw.println("=== " + FMT.format(new Date()) + " ===");
        pw.println("thread: " + (t == null ? "?" : t.getName()));
        String ver = "?";
        try {
            android.content.pm.PackageInfo pi = ctx.getPackageManager()
                    .getPackageInfo(ctx.getPackageName(), 0);
            ver = pi.versionName + " (" + pi.versionCode + ")";
        } catch (Throwable ignore) {
        }
        pw.println("app: " + ctx.getPackageName() + " version=" + ver);
        pw.println("android: " + Build.VERSION.RELEASE + " sdk=" + Build.VERSION.SDK_INT
                + " device=" + Build.MANUFACTURER + " " + Build.MODEL);
        e.printStackTrace(pw);
        pw.flush();

        String body = sw.toString();
        Log.e(TAG, "CRASH\n" + body);
        AppLog.e("CRASH: " + e, e);

        for (File dir : targets(ctx)) {
            try {
                if (dir == null) continue;
                if (!dir.isDirectory() && !dir.mkdirs()) continue;
                File f = new File(dir, FILE);
                // Sobrescrito a cada crash: o diagnostico util e o ultimo, nao o
                // historico inteiro.
                FileOutputStream os = new FileOutputStream(f, false);
                try {
                    os.write(body.getBytes("UTF-8"));
                } finally {
                    os.close();
                }
            } catch (Throwable ignore) {
            }
        }
    }

    private static File[] targets(Context ctx) {
        // getExternalFilesDir() = <sd>/Android/data/<pkg>/files, que e onde o
        // vitahub.log ja vive. O Download entra como destino extra porque o
        // MIUI bloqueia a leitura de Android/data por fora do app, e e o unico
        // lugar do armazenamento compartilhado que da para abrir tanto pelo
        // gerenciador do celular quanto por adb.
        return new File[] {
                ctx.getExternalFilesDir(null),
                new File("/storage/emulated/0/Download"),
        };
    }
}
