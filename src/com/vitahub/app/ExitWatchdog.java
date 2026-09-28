package com.vitahub.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.List;

/**
 * Descobre como a sessao anterior terminou.
 *
 * <p>Existe um buraco grande no registro de falhas do app: {@link CrashLog}
 * so enxerga excecao Java, e crash nativo (SIGSEGV, SIGABRT) mata o processo
 * sem passar por ele. Pior: nesta familia de aparelhos o logcat e o
 * Android/data nao sao legiveis de fora, entao um SIGSEGV deixa
 * literalmente nenhum rastro. Foi assim que um crash em
 * cs_disasm_iter passou a sessao inteira sem deixar pista.
 *
 * <p>Android 11+ resolve pela via Low Memory Killer: o sistema guarda o motivo
 * da saida, o sinal e um trace, e o proprio processo consulta no start
 * seguinte com {@code getHistoricalProcessExitReasons}. Nao exige permissao
 * para o proprio pacote.
 *
 * <p>O trace nativo vem em texto puro com os simbolos do {@code .so}; o que
 * interessa e o primeiro frame de codigo, entao isso e extraido e logado.
 */
final class ExitWatchdog {

    private static final int MAX_TRACE_LINES = 40;

    private ExitWatchdog() {
    }

    /**
     * Grava no log como a sessao anterior terminou e devolve o resumo.
     * Nunca lanca: um resumo indisponivel e melhor que um start falhado.
     */
    static JSONObject report(Context ctx) {
        JSONObject out = new JSONObject();
        // Todo JSONObject.put declara JSONException (checked) neste codigo. Como
        // este metodo nunca pode lancar -- uma falha aqui custaria um start
        // inteiro, nao um log -- cada escrita vai dentro de um try proprio.
        try {
            out.put("supported", Build.VERSION.SDK_INT >= 30);
        } catch (Throwable ignore) {
            return out;
        }
        if (Build.VERSION.SDK_INT < 30) {
            // Antes do Android 11 nao existe historico de saida. Dizer "nao ha
            // como saber" e melhor que devolver um objeto vazio e deixar a tela
            // silenciosa, que e como o log sumiu sem ninguem perceber.
            try {
                out.put("notSupported", true);
                out.put("sdk", Build.VERSION.SDK_INT);
            } catch (Throwable ignore) {
            }
            return out;
        }

        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return out;

            List<ApplicationExitInfo> infos =
                    am.getHistoricalProcessExitReasons(ctx.getPackageName(), 0, 4);
            if (infos == null || infos.isEmpty()) {
                AppLog.step("ExitWatchdog: sem historico de saida disponivel");
                return out;
            }

            // Mais recente primeiro. O que importa e a ultima saida do processo
            // do emulador, e nao a do processo do app principal: quem morre
            // num SIGSEGV e a Activity da engine.
            ApplicationExitInfo last = null;
            for (ApplicationExitInfo i : infos) {
                last = i;
                break;
            }
            if (last == null) return out;

            int reason = last.getReason();
            int status = last.getStatus();
            boolean abnormal = reason == ApplicationExitInfo.REASON_CRASH_NATIVE
                    || reason == ApplicationExitInfo.REASON_CRASH
                    || reason == ApplicationExitInfo.REASON_ANR
                    || reason == ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE;
            // "Anormal" e "o usuario precisa saber" sao coisas diferentes, e
            // confundir as duas custou tres versoes de diagnostico. LOW_MEMORY e
            // o motivo mais comum de "o app fecha depois de uns segundos em
            // qualquer tela" nesta familia de aparelho -- e ele NAO era
            // considerado anormal, entao o log recebia
            // "saida anterior=LOW_MEMORY" sem "(ABNORMAL)" e a tela nao mostrava
            // nada. A evidencia estava sendo gravada e recusada na porta.
            boolean notable = abnormal
                    || reason == ApplicationExitInfo.REASON_LOW_MEMORY
                    || reason == ApplicationExitInfo.REASON_SIGNALED;
            out.put("reason", reason);
            out.put("reasonName", reasonName(reason));
            out.put("status", status);
            out.put("abnormal", abnormal);
            out.put("notable", notable);
            out.put("timestamp", last.getTimestamp());
            out.put("uptimeMs", Math.max(0L, SystemClock.uptimeMillis() - last.getTimestamp()));
            out.put("pssKb", last.getPss());
            out.put("importance", last.getImportance());

            // O sinal so vale a pena como texto quando a saida foi por sinal.
            if (reason == ApplicationExitInfo.REASON_CRASH_NATIVE
                    || reason == ApplicationExitInfo.REASON_SIGNALED) {
                out.put("signal", describeSignal(status));
            }

            AppLog.step("ExitWatchdog: saida anterior=" + reasonName(reason)
                    + " status=" + status
                    + (notable ? " (RELEVANTE)" : "")
                    + " pss=" + last.getPss() + "kB"
                    + " ha=" + (last.getTraceInputStream() != null));
            if (notable) {
                String trace = readTrace(last);
                if (trace != null) {
                    AppLog.step("ExitWatchdog: trace da saida anterior:\n" + trace);
                }
            }
        } catch (Throwable t) {
            try {
                AppLog.e("ExitWatchdog falhou", t);
            } catch (Throwable ignore) {
            }
        }
        return out;
    }

    /**
     * O trace nativo do Android e texto com frames do processo morto. Trazer o
     * inicio para o log e o que permite ligar o sinal a um metodo, porque o
     * resto do trace e ruido de biblioteca do sistema.
     */
    private static String readTrace(ApplicationExitInfo info) {
        java.io.InputStream in = null;
        BufferedReader r = null;
        try {
            in = info.getTraceInputStream();
            if (in == null) return null;
            r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            int n = 0;
            while ((line = r.readLine()) != null && n < MAX_TRACE_LINES) {
                String t = line.trim();
                if (t.isEmpty()) continue;
                sb.append("    ").append(t).append('\n');
                n++;
            }
            return sb.length() == 0 ? null : sb.toString();
        } catch (Throwable t) {
            return null;
        } finally {
            try {
                if (r != null) r.close();
            } catch (Throwable ignore) {
            }
            try {
                if (in != null) in.close();
            } catch (Throwable ignore) {
            }
        }
    }

    private static String describeSignal(int status) {
        // Em REASON_CRASH_NATIVE o status carrega o numero do sinal.
        switch (status) {
            case 4: return "SIGILL";
            case 6: return "SIGABRT";
            case 7: return "SIGBUS";
            case 8: return "SIGFPE";
            case 11: return "SIGSEGV";
            default: return "sinal " + status;
        }
    }

    private static String reasonName(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_EXIT_SELF: return "EXIT_SELF";
            case ApplicationExitInfo.REASON_ANR: return "ANR";
            case ApplicationExitInfo.REASON_CRASH: return "CRASH";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "CRASH_NATIVE";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "LOW_MEMORY";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "EXCESSIVE_RESOURCE_USAGE";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "USER_REQUESTED";
            case ApplicationExitInfo.REASON_USER_STOPPED: return "USER_STOPPED";
            case ApplicationExitInfo.REASON_SIGNALED: return "SIGNALED";
            default: return "REASON_" + reason;
        }
    }
}
