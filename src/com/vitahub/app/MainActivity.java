package com.vitahub.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.lang.reflect.Constructor;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;


public class MainActivity extends Activity {

    private final Handler main = new Handler(Looper.getMainLooper());
    private static final int REQ_DIR = 1;
    private static final int REQ_FILE = 2;
    private static final int REQ_CAMERA = 3;
    private static final int REQ_PERM = 4;
    private static final String DEF_PKG = "org.vita3k.emulator";
    private static final String DEF_PKG2 = "org.vita3kplus.emulator";
    /** Teto de leitura de texto via bridge: evita OOM com PKG/PUP/ISO. */
    private static final long MAX_TEXT_FILE = 16L * 1024 * 1024;
    /** Teto de base64 via bridge: so e usado para icones PNG. */
    private static final long MAX_BASE64_FILE = 8L * 1024 * 1024;

    private WebView web;
    /** Como a sessao anterior terminou; null se ainda nao foi determinado. */
    private volatile JSONObject lastExit;
    private static final Object FW_INSTALL_LOCK = new Object();
    private static final Object NATIVE_LOCK = new Object();
    /** Resultado do bootstrap nativo, para nao repetir a cada chamada. */
    private static Boolean nativeSessionState = null;

    private final Bus bus = new Bus();
    private BroadcastReceiver storageReceiver;
    private final List<String> pendingDirHandlers = new ArrayList<String>();
    private final List<String> pendingFileHandlers = new ArrayList<String>();
    private final List<String> pendingCameraHandlers = new ArrayList<String>();
    private final List<String> pendingPermHandlers = new ArrayList<String>();
    private Uri cameraUri;
    private Uri lastPickedUri;
    private final Map<String, String> uriByPath = new HashMap<String, String>();
    private boolean immersive = true;

    private static class Bus {
        private final List<String> out = Collections.synchronizedList(new ArrayList<String>());
        private void push(JSONObject o) { out.add(o.toString()); }
        void reply(String id, Object v) {
            JSONObject o = new JSONObject();
            try {
                o.put("k", "r");
                o.put("id", Integer.parseInt(id));
                if (v == null) o.put("v", JSONObject.NULL);
                else if (v instanceof String || v instanceof Number || v instanceof Boolean) o.put("v", v);
                else o.put("v", v);
            } catch (Exception e) {
                Log.w("VitaHub", "Bus.reply descartada (id invalido: " + id + ")");
                return;
            }
            push(o);
        }
        void event(String name, JSONObject payload) {
            JSONObject o = new JSONObject();
            try { o.put("k", "e"); o.put("n", name); o.put("v", payload == null ? JSONObject.NULL : payload); } catch (Exception e) { return; }
            push(o);
        }
        String drain() {
            if (out.isEmpty()) return "[]";
            StringBuilder sb = new StringBuilder("[");
            synchronized (out) {
                for (int i = 0; i < out.size(); i++) {
                    if (i > 0) sb.append(',');
                    sb.append(out.get(i));
                }
                out.clear();
            }
            sb.append(']');
            return sb.toString();
        }
    }

    private static JSONObject ok() {
        JSONObject o = new JSONObject();
        try { o.put("ok", true); } catch (Exception ignore) {}
        return o;
    }
    private static JSONObject err(String msg) {
        JSONObject o = new JSONObject();
        try { o.put("ok", false); o.put("error", msg); } catch (Exception ignore) {}
        return o;
    }
    private static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (Exception ignore) {}
    }
    private static String arg(JSONObject a, String k, String dflt) {
        return a == null ? dflt : a.optString(k, dflt);
    }
    private static long argLong(JSONObject a, String k, long dflt) {
        return a == null ? dflt : a.optLong(k, dflt);
    }
    private static String readStream(InputStream in, int cap) throws Exception {
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int total = 0, n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
                total += n;
                if (total >= cap) break;
            }
            return bo.toString("UTF-8");
        } finally {
            try { in.close(); } catch (Exception ignore) {}
        }
    }

    /**
     * Le a cauda de um log e colapsa linhas repetidas.
     *
     * <p>Sem o colapso o log da engine e inutilizavel: uma falha de
     * apresentacao no OpenGL repete a mesma linha milhares de vezes e o que
     * importa — "isto falhou N vezes" — some no meio do ruido. Aqui a repeticao
     * vira "linha ×N", que cabe numa tela e ainda diz a magnitude.
     */
    private JSONObject readLogFile(String which, int maxBytes) {
        String name = "engine".equalsIgnoreCase(which) ? "vita3k.log" : "vitahub.log";
        File f = new File(getExternalFilesDir(null), name);
        JSONObject out = new JSONObject();
        try {
            out.put("which", name);
            out.put("exists", f.isFile());
            if (!f.isFile()) {
                out.put("text", "");
                out.put("bytes", 0);
                return out;
            }
            long len = f.length();
            out.put("bytes", len);
            RandomAccessFile raf = new RandomAccessFile(f, "r");
            try {
                long from = Math.max(0, len - maxBytes);
                raf.seek(from);
                byte[] b = new byte[(int) Math.min(len - from, maxBytes)];
                raf.readFully(b);
                out.put("text", collapseRepeats(new String(b, 0, b.length, "UTF-8")));
                out.put("truncated", from > 0);
            } finally {
                try { raf.close(); } catch (Throwable ignore) {}
            }
        } catch (Throwable e) {
            try {
                out.put("text", "falha ao ler: " + e);
            } catch (Throwable ignore) {}
        }
        return out;
    }

    private static String collapseRepeats(String text) {
        StringBuilder sb = new StringBuilder();
        String prev = null;
        int count = 0;
        for (String line : text.split("\n", -1)) {
            String t = line.endsWith("\r") ? line.substring(0, line.length() - 1) : line;
            if (t.equals(prev)) {
                count++;
                continue;
            }
            if (count > 1) sb.append(prev).append("  ×").append(count).append('\n');
            else if (prev != null) sb.append(prev).append('\n');
            prev = t;
            count = 1;
        }
        if (prev != null) {
            if (count > 1) sb.append(prev).append("  ×").append(count).append('\n');
            else sb.append(prev).append('\n');
        }
        return sb.toString();
    }

    /**
     * Abre a conexao na rede "certa" em vez de deixar o Android escolher.
     * Abre a conexao na rede "certa" em vez de deixar o Android escolher.
     *
     * Sem isso o update checker falhava com "No address associated with
     * hostname" em aparelhos com duas redes ativas: a cellular veio sem
     * servidor DNS (DnsAddresses vazio) e ficou com o roteamento, enquanto o
     * shell resolvia nome normalmente pela WiFi. Aqui a rede e fixada
     * explicitamente, com fallback para qualquer rede com INTERNET e, por
     * ultimo, para o caminho padrao.
     */
    private HttpURLConnection openNet(String url) throws Exception {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            try {
                Network best = null;
                int bestScore = -1;
                Network[] all = cm.getAllNetworks();
                for (Network nw : all) {
                    NetworkCapabilities c = cm.getNetworkCapabilities(nw);
                    if (c == null || !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue;
                    int score = 0;
                    if (c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) score += 4;
                    if (!c.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL)) score += 1;
                    if (cm.getActiveNetwork() != null && nw.equals(cm.getActiveNetwork())) score += 2;
                    if (score > bestScore) { bestScore = score; best = nw; }
                }
                StringBuilder dbg = new StringBuilder("openNet redes=" + (all == null ? -1 : all.length) + " chosen=" + best);
                if (all != null) for (Network nw : all) {
                    NetworkCapabilities cc = cm.getNetworkCapabilities(nw);
                    android.net.LinkProperties lp = cm.getLinkProperties(nw);
                    dbg.append(" | ").append(nw).append(" caps=").append(cc).append(" dns=").append(lp == null ? "?" : lp.getDnsServers());
                }
                AppLog.i("DBG " + dbg.toString());
                if (best != null) {
                    HttpURLConnection hc = (HttpURLConnection) best.openConnection(new URL(url));
                    if (hc != null) return hc;
                }
            } catch (Throwable ignore) { AppLog.e("DBG openNet falhou", ignore); }
        }
        AppLog.i("DBG openNet usando caminho padrao");
        return (HttpURLConnection) new URL(url).openConnection();
    }

    private String enginePkg() {
        PackageManager pm = getPackageManager();
        String[] cands = new String[] { DEF_PKG, DEF_PKG2 };
        for (String p : cands) {
            try {
                pm.getPackageInfo(p, 0);
            } catch (Exception ignore) {}
        }
        for (String p : cands) {
            try {
                pm.getPackageInfo(p, 0);
                if (pm.getLaunchIntentForPackage(p) != null) return p;
            } catch (Exception ignore) {}
        }
        return null;
    }

    private File externalRoot() {
        File f = getExternalFilesDir(null);
        return f != null ? f : getFilesDir();
    }

    /**
     * Onde a arvore de jogos vive por padrao.
     *
     * <p>Era o diretorio privado do app (Android/data/&lt;pkg&gt;/files/vita), e
     * isso e um problema estrutural, nao um detalhe: o Android 11+ bloqueia
     * Android/data para o seletor de arquivos do sistema E para o gerenciador do
     * aparelho, e o desinstalador apaga o diretorio inteiro. O usuario nao
     * alcança a biblioteca com nenhuma ferramenta, e cada problema vira uma
     * escolha entre fechar o app e perder os jogos.
     *
     * <p>A pasta compartilhada resolve os dois de uma vez: sobrevive a
     * desinstalacao e aparece no gerenciador de arquivos. Em troca exige
     * acesso a todos os arquivos, que o app ja pede e checa
     * ({@link #hasStorageAccess()}).
     */
    private String defaultInstallDir() {
        File shared = sharedRoot();
        if (shared != null) return shared.getAbsolutePath();
        return new File(externalRoot(), "vita").getAbsolutePath();
    }

    /** Raiz compartilhada do usuario, ou null se o volume nao der para escrever. */
    private File sharedRoot() {
        File emu = android.os.Environment.getExternalStorageDirectory();
        if (emu == null) return null;
        File f = new File(emu, "VitaHub");
        // O Android em alguns aparelhos monta /storage/emulated/0 como somente
        // leitura para quem nao tem acesso total; nesse caso o chamador cai no
        // diretorio privado em vez de prometer uma pasta que nao da para gravar.
        if (!f.isDirectory() && !f.mkdirs()) return null;
        if (!f.canWrite()) return null;
        return f;
    }

    // ------------------------------------------------------------------
    // Volumes: interno, cartao SD e pendrive USB
    // ------------------------------------------------------------------
    // Nao ha permissao de USB aqui de proposito: quem monta o pendrive e o
    // vold, e a partir dai ele aparece como um volume comum em
    // /storage/<UUID>, identico a um cartao SD. O que o app precisa mesmo e de
    // acesso a arquivo nesse caminho, e isso depende da versao do Android:
    // ate o 29 vale READ_EXTERNAL_STORAGE; do 30 em diante o armazenamento
    // com escopo exige "acesso a todos os arquivos".
    private JSONArray listVolumes() {
        JSONArray arr = new JSONArray();
        boolean allFiles = Build.VERSION.SDK_INT < 30 || Environment.isExternalStorageManager();
        try {
            StorageManager sm = (StorageManager) getSystemService(Context.STORAGE_SERVICE);
            if (sm != null) {
                for (StorageVolume v : sm.getStorageVolumes()) {
                    File dir = volumeDir(v);
                    if (dir == null) continue;
                    String path = dir.getAbsolutePath();
                    // getState() devolve String ("mounted"/"unmounted"), nao um int: as
                    // constantes STATE_* sao @hide e nao existem no SDK publico.
                    boolean mounted = "mounted".equals(v.getState());
                    boolean primary = v.isPrimary();
                    boolean removable = v.isRemovable();
                    // getExternalFilesDirs() tambem devolve o volume primario e
                    // um volume ja listado acima apareceria duas vezes na UI.
                    boolean dup = false;
                    for (int i = 0; i < arr.length(); i++) {
                        if (path.equals(arr.getJSONObject(i).optString("path"))) { dup = true; break; }
                    }
                    if (dup) continue;
                    // Pasta que seria usada se o usuario escolher este volume.
                    // No interno ela continua sendo o diretorio do proprio app
                    // (Android/data/<pkg>/files/vita), que funciona sem nenhuma
                    // permissao especial; no removivel nao ha como escapar de
                    // /storage/<UUID>, que e o que o emulador le como pref-path.
                    String suggested = primary
                            ? defaultInstallDir()
                            : path.replaceAll("/+$", "") + "/VitaHub/vita";
                    JSONObject o = new JSONObject();
                    o.put("path", path);
                    o.put("suggested", suggested);
                    o.put("label", volumeLabel(v, dir, primary, removable));
                    o.put("primary", primary);
                    o.put("removable", removable);
                    o.put("mounted", mounted);
                    o.put("free", dir.getUsableSpace());
                    o.put("total", dir.getTotalSpace());
                    // A leitura e o teste de escrita sao o que a UI usa para
                    // avisar "conceda permissao" em vez de deixar o usuario
                    // descobrir um EACCES no meio de uma instalacao.
                    o.put("readable", mounted && (primary ? dir.canRead() : (dir.canRead() && dir.list() != null)));
                    o.put("writable", mounted && probeWritable(suggested));
                    o.put("allFiles", allFiles);
                    arr.put(o);
                }
            }
        } catch (Throwable ignore) {}
        if (arr.length() == 0) {
            // Sem StorageManager (ou com ele Lancando): pelo menos o volume
            // principal, que nunca deixa de existir.
            try {
                File d = externalRoot();
                JSONObject o = new JSONObject();
                o.put("path", d.getAbsolutePath());
                o.put("suggested", defaultInstallDir());
                o.put("label", d.getAbsolutePath());
                o.put("primary", true);
                o.put("removable", false);
                o.put("mounted", d.isDirectory());
                o.put("free", d.getUsableSpace());
                o.put("total", d.getTotalSpace());
                o.put("readable", d.canRead());
                o.put("writable", d.canWrite());
                o.put("allFiles", allFiles);
                arr.put(o);
            } catch (Exception ignore) {}
        }
        return arr;
    }

    /**
     * Raiz de um volume. getDirectory() so existe do API 30 em diante; antes
     * disso o caminho do volume sai do diretorio por-app, que o sistema cria em
     * CADA volume montado (e por isso o pendrive aparece aqui tambem).
     */
    private File volumeDir(StorageVolume v) {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                File d = v.getDirectory();
                if (d != null) return d;
            } catch (Exception ignore) {}
        }
        String marker = "/Android/data/" + getPackageName() + "/files";
        try {
            File[] dirs = getExternalFilesDirs(null);
            for (File f : dirs) {
                if (f == null) continue;
                String p = f.getAbsolutePath();
                int i = p.indexOf(marker);
                if (i > 0) return new File(p.substring(0, i));
            }
        } catch (Exception ignore) {}
        return null;
    }

    /** Nome legivel: o rotulo do sistema quando existe, senaio o nome do volume. */
    private String volumeLabel(StorageVolume v, File dir, boolean primary, boolean removable) {
        try {
            String d = v.getDescription(this);
            if (d != null && d.length() > 0) return d;
        } catch (Throwable ignore) {}
        if (primary) return dir.getAbsolutePath();
        String n = dir.getName();
        if (n == null || n.length() == 0) n = dir.getAbsolutePath();
        return removable ? n : dir.getAbsolutePath();
    }

    /**
     * Acesso ao armazenamento compartilhado (necessario para ver o pendrive e
     * o cartao SD). Ate o Android 10 e uma permissao de runtime; do 11 em
     * diante o "acesso a todos os arquivos" e um interruptor de sistema, e o
     * app so consegue ler depois que o usuario o liga.
     */
    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        // Ate o Android 10 ler e gravar sao permissoes separadas. So olhar a
        // de leitura dava "liberado" com a escrita negada, e a criacao da pasta
        // vita/ no pendrive falhava depois disso.
        return checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean openAllFilesSettings() {
        if (Build.VERSION.SDK_INT < 30) return false;
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
            return true;
        } catch (Exception ignore) {}
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            return true;
        } catch (Exception ignore) {}
        return false;
    }

    /**
     * Abre uma URL de fora do app (loja, navegador, release notes).
     *
     * <p>A allowlist de esquema e o que impede o redirecionamento de intent: sem
     * ela, um link com file:, content: ou intent: virava um disparador de
     * qualquer componente exportado do aparelho — e a URL vem de dados que o
     * app nao controla (conteudo de uma release, link digitado no navegador
     * interno, item da loja).
     */
    private boolean openExternalUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme();
            if (scheme == null) return false;
            scheme = scheme.toLowerCase();
            if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) {
                AppLog.w("openExternal: esquema bloqueado: " + scheme);
                return false;
            }
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // Nao usar resolveActivity() como guarda: a partir do Android 11 a
            // visibilidade de pacotes e' restrita e ele devolve null mesmo
            // com o app instalado, o que fazia o link parecer quebrado.
            // Tentar abrir e tratar ActivityNotFoundException cobre os dois.
            try {
                startActivity(i);
                return true;
            } catch (android.content.ActivityNotFoundException e) {
                AppLog.w("openExternal: nenhum app para " + scheme);
                return false;
            }
        } catch (Exception e) {
            return false;
        }
    }

    // ------------------------------------------------------------------
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        CrashLog.install(this);
        AppLog.init(this);
        AppLog.step("MainActivity.onCreate pid=" + android.os.Process.myPid());
        // Antes de qualquer tela: se a sessao anterior morreu de forma
        // anormal, isso e a unica evidencia que existe (crash nativo nao passa
        // pelo CrashLog e o logcat nao e legivel neste aparelho).
        lastExit = ExitWatchdog.report(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN);
        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        // O inspetor remoto so em build de desenvolvimento. Ligado sempre, ele
        // deixa qualquer app com depuracao USB (ou um app exploravel) anexar
        // uma pagina a este WebView e chamar a bridge privilegiada junto.
        boolean debugWeb = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debugWeb);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // A UI vive em file:///android_asset. O acesso a arquivo e o minimo
        // para isso; o acesso Universal allow a qualquer pagina carregada ler
        // arquivos do disco e chamar a bridge com o privilegio dela, entao
        // fica desligado. E o conteudo de arquivo tambem nao pode mais abrir
        // paginas de file:// em um frame com acesso a rede.
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowFileAccessFromFileURLs(false);
        // A UI nao baixa nada por http; o que trafega e o app, pelo host.
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // O som do boot toca sozinho, sem gesto do usuario.
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                android.util.Log.i("VitaHub", "PAGE_LOADED " + url);
            }

            // A UI e um arquivo estatico: qualquer navegacao para fora dela e
            // um link de terceiros (loja, navegador interno). O que acontece
            // depois nao e responsabilidade do WebView, e sim de openExternal,
            // que tem allowlist de esquema.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                if (url.startsWith("file:///android_asset/")) return false;
                try {
                    openExternalUrl(url);
                } catch (Exception ignore) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                android.util.Log.i("VitaHub-WEB", cm.messageLevel() + ": " + cm.message());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        setContentView(web);
        watchStorage();
        web.loadUrl("file:///android_asset/index.html");
    }

    /**
     * Avisa a UI quando um pendrive/cartao e montado ou desmontado. Sem isso a
     * lista de volumes so mudava ao abrir Configuracoes de novo, e o usuario
     * ficava achando que o app nao enxerga o pendrive que acabou de plugar.
     *
     * <p>Registrado em codigo, e nao no manifesto, porque o registro estatico
     * ficaria vivo mesmo com o app em background.
     */
    private void watchStorage() {
        try {
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_MEDIA_MOUNTED);
            f.addAction(Intent.ACTION_MEDIA_UNMOUNTED);
            f.addAction(Intent.ACTION_MEDIA_EJECT);
            f.addAction(Intent.ACTION_MEDIA_SCANNER_FINISHED);
            f.addDataScheme("file");
            storageReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent i) {
                    if (i == null) return;
                    String a = i.getAction();
                    if (a == null) return;
                    JSONObject p = new JSONObject();
                    try {
                        p.put("action", a);
                        p.put("state", i.getExtras() == null ? null : i.getExtras().getString("state"));
                        Uri d = i.getData();
                        p.put("path", d == null ? null : d.getPath());
                    } catch (Exception ignore) { return; }
                    bus.event("storage:changed", p);
                }
            };
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(storageReceiver, f, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(storageReceiver, f);
            }
        } catch (Exception e) {
            AppLog.w("watchStorage: " + e);
            storageReceiver = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (storageReceiver != null) {
            try { unregisterReceiver(storageReceiver); } catch (Exception ignore) {}
            storageReceiver = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && immersive) hideSystemUI();
    }

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = web.getWindowInsetsController();
            if (c != null) {
                c.hide(android.view.WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            web.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    private void showSystemUI() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = web.getWindowInsetsController();
            if (c != null) c.show(android.view.WindowInsets.Type.systemBars());
        } else {
            web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    @Override
    public void onBackPressed() {
        if (!immersive) {
            immersive = true;
            hideSystemUI();
            return;
        }
        moveTaskToBack(true);
    }

    // ------------------------------------------------------------------
    private class Bridge {
        @JavascriptInterface
        public void call(final String method, final String argsJson, final String id) {
            main.post(new Runnable() {
                public void run() {
                    try {
                        JSONObject a = (argsJson == null || argsJson.isEmpty()) ? new JSONObject() : new JSONObject(argsJson);
                        dispatch(method, a, id);
                    } catch (Throwable t) {
                        bus.reply(id, err("exception: " + t.getMessage()));
                    }
                }
            });
        }

        @JavascriptInterface
        public String poll() {
            return bus.drain();
        }
    }

    @SuppressWarnings("deprecation")
    private void dispatch(String method, JSONObject a, String id) throws Exception {
        String home = getFilesDir().getAbsolutePath();
        switch (method) {
            case "homeDir":
                bus.reply(id, getFilesDir().getAbsolutePath());
                return;
            case "storageDir":
                bus.reply(id, externalRoot().getAbsolutePath());
                return;
            case "defaultDir":
                bus.reply(id, defaultInstallDir());
                return;
            case "installDir":
                bus.reply(id, defaultInstallDir());
                return;
            case "volumes": {
                final String ridVol = id;
                // Fora da UI thread, como readFile/exists/listDir. listVolumes()
                // nao e so uma consulta: para cada volume ele chama
                // getUsableSpace()/getTotalSpace() (statfs, que bloqueia em
                // cartao SD) e probeWritable(), que CRIA a pasta e escreve um
                // arquivo de teste. Tudo isso na main thread segurava a WebView
                // por segundos, e o sistema matava o processo -- o app
                // "fechava" exatamente ao abrir Configuracoes, a unica tela que
                // lista volumes. readFile, exists, listDir, sfoTitle e
                // sfoCategory ja saiam daqui para fora; volumes ficou de fora e
                // era o unico metodo de leitura com I/O de disco ainda preso a
                // main thread.
                Thread tv = new Thread(new Runnable() {
                    public void run() {
                        bus.reply(ridVol, listVolumes());
                    }
                }, "vitahub-volumes");
                tv.setDaemon(true);
                tv.start();
                return;
            }
            case "setPrefPath": {
                // Trocar o diretorio de instalacao para um cartao SD ou um
                // pendrive so surte efeito no config.yml da engine ANTES da
                // sessao nativa ser criada: e o pref-path lido no init que
                // decide onde a arvore vita/ nasce. O boot seguinte do
                // emulador faria o patch, mas nesse meio tempo o firmware
                // instalado ficaria na pasta antiga.
                final String np = arg(a, "path", "");
                if (np.isEmpty()) { bus.reply(id, err("caminho vazio")); return; }
                try {
                    File cfg = new File(externalRoot(), "config.yml");
                    String text = null;
                    if (cfg.isFile()) {
                        FileInputStream fin = new FileInputStream(cfg);
                        try {
                            ByteArrayOutputStream bo = new ByteArrayOutputStream();
                            byte[] b = new byte[8192];
                            int n;
                            while ((n = fin.read(b)) > 0) {
                                bo.write(b, 0, n);
                                if (bo.size() > 4 * 1024 * 1024) break;   // config.yml nao tem 4 MB
                            }
                            text = new String(bo.toByteArray(), "UTF-8");
                        } finally {
                            fin.close();
                        }
                    }
                    if (text == null || text.length() == 0) {
                        // Sem config.yml ainda: a sessao nativa cria um a
                        // partir do asset no primeiro init, entao o caminho so
                        // precisa estar no config.json do app (EngineActivity
                        // le-o no boot e aplica o pref-path).
                        bus.reply(id, ok());
                        return;
                    }
                    writeSmall(cfg, EngineActivity.applyPrefPath(text, np).getBytes("UTF-8"));
                    AppLog.step("setPrefPath: pref-path = " + np);
                    bus.reply(id, ok());
                } catch (Throwable e) {
                    bus.reply(id, err(String.valueOf(e.getMessage())));
                }
                return;
            }
            case "version": {
                JSONObject v = new JSONObject();
                v.put("name", "VitaHub");
                v.put("codename", "com.vitahub.app");
                // Lido do manifesto instalado: o update checker compara este
                // valor com a tag da release, entao ele nao pode divergir do
                // que o APK realmente e (a versao era fixa e nunca subia).
                String vn = "1.0.0";
                long vc = 1;
                try {
                    android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                    if (pi.versionName != null && !pi.versionName.isEmpty()) vn = pi.versionName;
                    vc = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
                } catch (Exception e) {
                    Log.w("VitaHub", "version: PackageInfo falhou: " + e);
                }
                v.put("version", vn);
                v.put("versionCode", vc);
                v.put("platform", "android");
                bus.reply(id, v);
                return;
            }
            case "readFile": {
                final String path = arg(a, "path", "");
                final String rid = id;
                // Le fora da UI thread: antes isto alocava byte[(int) f.length()]
                // na main thread (OutOfMemoryError/ANR em arquivos grandes) e
                // ainda podia ler menos bytes que o esperado num unico read().
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File f = new File(path);
                            if (!f.isFile() || f.length() > MAX_TEXT_FILE) {
                                bus.reply(rid, null);
                                return;
                            }
                            bus.reply(rid, readAll(f));
                        } catch (Throwable e) {
                            bus.reply(rid, null);
                        }
                    }
                }, "vitahub-readfile");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "sfoTitle": {
                final String sfo = arg(a, "path", "");
                final String ridSfo = id;
                // Fora da UI thread, como readFile/appInfo: readParamTitle le e
                // interpreta o param.sfo, e listApps() chama isto uma vez por
                // jogo. Na main thread um cartão lento ou uma biblioteca grande
                // segura o toque da WebView — o app fica sem responder a cliques
                // sem nenhum erro, porque a fila da ponte para de andar.
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            bus.reply(ridSfo, PkgExtractor.readParamTitle(sfo));
                        } catch (Throwable e) {
                            bus.reply(ridSfo, err(String.valueOf(e.getMessage())));
                        }
                    }
                }, "vitahub-sfo");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "sfoCategory": {
                final String sfoCat = arg(a, "path", "");
                final String ridCat = id;
                // Mesma razao do sfoTitle: uma leitura de disco por titulo, e
                // listApps() chama isto para cada pasta de ux0/app.
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            bus.reply(ridCat, PkgExtractor.readParamCategory(sfoCat));
                        } catch (Throwable e) {
                            bus.reply(ridCat, err(String.valueOf(e.getMessage())));
                        }
                    }
                }, "vitahub-sfo-cat");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "appInfo": {
                final String aid = arg(a, "path", "");
                final String ridI = id;
                // Fora da UI thread: dirSize() percorre a arvore inteira e um
                // jogo de varios GB travaria a interface.
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        // appInfoJson monta JSON e percorre a arvore do jogo;
                        // excecao solta aqui derrubaria o processo.
                        try {
                            bus.reply(ridI, appInfoJson(aid));
                        } catch (Throwable e) {
                            bus.reply(ridI, new JSONObject());
                        }
                    }
                }, "vitahub-appinfo");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "deleteApp": {
                final String dpath = arg(a, "path", "");
                final String ridD = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File d = new File(dpath);
                            if (!d.isDirectory()) {
                                bus.reply(ridD, err("pasta do app nao encontrada"));
                                return;
                            }
                            // Apagar e a unica operacao destrutiva da bridge
                            // e ela nao volta. Um caminho errado aqui (bug na UI,
                            // pasta trocada no meio, sessao antiga) apagava a
                            // arvore vita inteira ou o pendrive do usuario sem
                            // nenhuma chance de recuperar.
                            String why = AppTree.notAnInstalledApp(d);
                            if (why != null) {
                                AppLog.w("deleteApp recusado em " + dpath + ": " + why);
                                bus.reply(ridD, err("recusado: " + why));
                                return;
                            }
                            deleteTree(d);
                            bus.reply(ridD, ok());
                        } catch (Throwable e) {
                            bus.reply(ridD, err(String.valueOf(e.getMessage())));
                        }
                    }
                }, "vitahub-delapp");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "base64File": {
                final String b64path = arg(a, "path", "");
                final String rid2 = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        // try/catch obrigatorio aqui: uma excecao solta nesta
                        // thread mata o processo inteiro (default handler), e nao
                        // so a chamada. base64File roda para o icone de cada
                        // jogo quando a home monta.
                        try {
                            bus.reply(rid2, readPngAsBase64(new File(b64path)));
                        } catch (Throwable e) {
                            bus.reply(rid2, null);
                        }
                    }
                }, "vitahub-b64");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "writeFileAtomic": {
                // config.json e reescrito a cada lancamento de jogo e contem o
                // installDir e os favoritos do usuario. FileOutputStream TRUNCA
                // o arquivo: se o processo morresse no meio da escrita (e o
                // aparelho mata o app o tempo todo, ver ExitWatchdog), o
                // config.json ficava pela metade e loadConfig() caia no default
                // sem aviso -- a biblioteca passava a ser procurada no
                // armazenamento interno e os jogos "sumiam" sem nada ter sido
                // apagado. Escreve num .tmp e renomeia: renameTo no mesmo
                // sistema de arquivos e atomico, entao ou a versao antiga
                // fica ou a nova, nunca um meio arquivo.
                final String apath = arg(a, "path", "");
                final String acontent = a.optString("content", "");
                final String arid = id;
                Thread ta = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File f = new File(apath);
                            if (f.getParentFile() != null) f.getParentFile().mkdirs();
                            File tmp = new File(apath + ".tmp");
                            FileOutputStream os = new FileOutputStream(tmp);
                            try {
                                os.write(acontent.getBytes("UTF-8"));
                                os.flush();
                                // fsync: sem isso o rename pode publicar um
                                // arquivo cujo conteudo ainda esta no buffer.
                                try { os.getFD().sync(); } catch (Throwable ignore) { }
                            } finally {
                                os.close();
                            }
                            if (!tmp.renameTo(f)) {
                                // Alguns sistemas de arquivos recusam rename por
                                // cima: apaga o destino e tenta de novo, que e o
                                // unico caminho sem perder a config nova.
                                f.delete();
                                if (!tmp.renameTo(f)) {
                                    bus.reply(arid, err("nao foi possivel substituir " + apath));
                                    return;
                                }
                            }
                            bus.reply(arid, Boolean.TRUE);
                        } catch (Throwable e) {
                            bus.reply(arid, err(String.valueOf(e.getMessage())));
                        }
                    }
                }, "vitahub-writeatomic");
                ta.setDaemon(true);
                ta.start();
                return;
            }
            case "du": {
                // Tamanho total de uma arvore. A migracao para a pasta
                // compartilhada precisa saber o espaco necessario ANTES de
                // copiar: encher o armazenamento no meio da copia e o jeito
                // mais rapido de perder a biblioteca do usuario.
                final String upath = arg(a, "path", "");
                final String ridDu = id;
                Thread td = new Thread(new Runnable() {
                    public void run() {
                        try {
                            bus.reply(ridDu, duRec(new File(upath)));
                        } catch (Throwable e) {
                            bus.reply(ridDu, -1L);
                        }
                    }
                }, "vitahub-du");
                td.setDaemon(true);
                td.start();
                return;
            }
            case "copyTree": {
                // Copia recursiva de arvore com progresso. copyFile() so
                // resolve arquivo: a arvore de jogos tem milhares deles, e
                // percorre-los pela ponte perderia o fio.
                final String tsrc = arg(a, "src", "");
                final String tdst = arg(a, "dst", "");
                final String ridCt = id;
                Thread tct = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File s = new File(tsrc);
                            if (!s.exists()) { bus.reply(ridCt, err("origem inexistente")); return; }
                            long total = duRec(s);
                            final long[] done = new long[]{0L};
                            JSONObject o = new JSONObject();
                            o.put("ok", Boolean.TRUE);
                            o.put("total", total);
                            o.put("bytes", 0L);
                            o.put("files", 0L);
                            // 256 KB de granularidade: um evento por arquivo daria
                            // dezenas de milhares de mensagens pela ponte, e a
                            // propria passagem de mensagens viraria o gargalo.
                            o.put("since", 0L);
                            bus.reply(ridCt, copyTree(s, new File(tdst), done, total, o));
                        } catch (Throwable e) {
                            bus.reply(ridCt, err(String.valueOf(e.getMessage())));
                        }
                    }
                }, "vitahub-copytree");
                tct.setDaemon(true);
                tct.start();
                return;
            }
            case "writeFile": {
                final String wpath = arg(a, "path", "");
                final String content = a.optString("content", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File f = new File(wpath);
                            if (f.getParentFile() != null) f.getParentFile().mkdirs();
                            FileOutputStream os = new FileOutputStream(f);
                            try {
                                os.write(content.getBytes("UTF-8"));
                            } finally {
                                os.close();
                            }
                            bus.reply(rid, Boolean.TRUE);
                        } catch (Throwable e) {
                            bus.reply(rid, err(String.valueOf(e.getMessage())));
                        }
                    }
                }, "vitahub-writefile");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "exists": {
                final String epath = arg(a, "path", "");
                final String ridEx = id;
                // exists() parece barato, mas num cartão SD ou pendrive é uma
                // consulta de disco, e listApps() chama isto por diretório de
                // jogo. Reply fora da UI thread pelo mesmo motivo de sfoTitle.
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        bus.reply(ridEx, new File(epath).exists());
                    }
                }, "vitahub-exists");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "probeEboot": {
                final String dir = arg(a, "path", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File f = new File(dir, "eboot.bin");
                            JSONObject o = new JSONObject();
                            if (!f.exists()) {
                                o.put("kind", "missing");
                                o.put("size", 0L);
                                bus.reply(rid, o);
                                return;
                            }
                            byte[] hdr = new byte[4];
                            int r;
                            try (FileInputStream in = new FileInputStream(f)) {
                                r = in.read(hdr);
                            }
                            if (r < 4) {
                                o.put("kind", "tiny");
                                o.put("size", f.length());
                            } else if (hdr[0] == 0x53 && hdr[1] == 0x43 && hdr[2] == 0x45 && hdr[3] == 0x00) {
                                o.put("kind", "self");
                                o.put("size", f.length());
                            } else if (hdr[0] == 0x7F && hdr[1] == 0x45 && hdr[2] == 0x4C && hdr[3] == 0x46) {
                                o.put("kind", "elf");
                                o.put("size", f.length());
                            } else {
                                o.put("kind", "enc");
                                o.put("size", f.length());
                            }
                            bus.reply(rid, o);
                        } catch (Throwable ex) {
                            bus.reply(rid, err("probe falhou"));
                        }
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "mkdirs":
                bus.reply(id, new File(arg(a, "path", "")).mkdirs());
                return;
            case "deleteFile": {
                File f = new File(arg(a, "path", ""));
                bus.reply(id, f.exists() && deleteRec(f));
                return;
            }
            case "listDir": {
                final String lpath = arg(a, "path", "");
                final String ridLs = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File dirF = new File(lpath);
                            File[] kids = dirF.listFiles();
                            if (kids == null) {
                                // listFiles() devolvendo null e o modo silencioso
                                // de "biblioteca vazia": a pasta nao existe, o
                                // volume sumiu, ou falta permissao. A UI so via
                                // "nenhum jogo instalado", entao o motivo vai
                                // para o log que o usuario consegue ler no app.
                                if (lpath.contains("ux0/app") || lpath.contains("pspemu/PSP/GAME")) {
                                    AppLog.w("listDir " + lpath + " -> listFiles() null (existe=" + dirF.exists()
                                            + ", isDir=" + dirF.isDirectory() + ", canRead=" + dirF.canRead() + ")");
                                }
                                bus.reply(ridLs, null);
                                return;
                            }
                            if (lpath.contains("ux0/app") || lpath.contains("pspemu/PSP/GAME")) {
                                StringBuilder sb = new StringBuilder();
                                for (File k : kids) {
                                    if (sb.length() > 0) sb.append(' ');
                                    sb.append(k.getName()).append(k.isDirectory() ? "(dir)" : "(file)");
                                }
                                AppLog.i("listDir " + lpath + " -> " + kids.length + " entradas: " + sb);
                            }
                            JSONArray arr = new JSONArray();
                            for (File k : kids) {
                                JSONObject o = new JSONObject();
                                o.put("n", k.getName());
                                o.put("d", k.isDirectory());
                                arr.put(o);
                            }
                            bus.reply(ridLs, arr);
                        } catch (Throwable e) {
                            bus.reply(ridLs, null);
                        }
                    }
                }, "vitahub-listdir");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "copy": {
                final String src = arg(a, "src", "");
                final String dst = arg(a, "dst", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        boolean ok = copyFile(new File(src), new File(dst));
                        bus.reply(rid, ok);
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "move": {
                final String src = arg(a, "src", "");
                final String dst = arg(a, "dst", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        File s = new File(src);
                        File d = new File(dst);
                        boolean ok = false;
                        if (s.exists()) {
                            if (d.getParentFile() != null) d.getParentFile().mkdirs();
                            ok = s.renameTo(d);
                            if (!ok) ok = copyFile(s, d) && deleteRec(s);
                        }
                        bus.reply(rid, ok);
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "fwInstall": {
                final String pup = arg(a, "path", "");
                final String rid = id;
                if (pup.isEmpty()) { bus.reply(rid, err("caminho do PUP vazio")); return; }
                // O par init+installFirmware roda inteiro no worker vitahub-fw-install.
                // Uma versao anterior rodava NativeLib.init na UI thread (main.post)
                // por causa de um comentario que afirmava que JNI em Thread "crua"
                // abortava com SIGSEGV. Isso foi medido e e FALSO: reproduzindo o
                // mesmo par contra o mesmo classes.dex da engine, em processo
                // separado e sem Activity nenhuma, os dois modos funcionam
                // (main thread e worker), com progresso completo e versao 3.74.
                // Manter init na UI thread so trazia risco de ANR: init carrega
                // libVita3K.so (27 MB) e monta a arvore vita/, e pode levar
                // centenas de ms. O worker tambem evita que o MemoryService do
                // MIUI mate a Activity da UI no meio da operacao.
                File pupFile = new File(pup);
                if (!pupFile.isFile() || pupFile.length() == 0) {
                    bus.reply(rid, err("arquivo PUP nao encontrado: " + pup));
                    return;
                }
                startFirmwareInstall(pup, rid);
                return;
            }
            case "pupVersion": {
                final String p = arg(a, "path", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            RandomAccessFile f = new RandomAccessFile(p, "r");
                            byte[] m = new byte[4];
                            f.readFully(m, 0, 4);
                            if (!(m[0] == 'S' && m[1] == 'C' && m[2] == 'E')) {
                                f.close();
                                bus.reply(rid, err("arquivo nao e um PUP valido"));
                                return;
                            }
                            f.seek(0x18);
                            int count = Integer.reverseBytes(f.readInt());
                            String ver = "";
                            for (int x = 0; x < count && x < 512; x++) {
                                f.seek(0x80L + x * 0x20L);
                                long type = Long.reverseBytes(f.readLong());
                                long off = Long.reverseBytes(f.readLong());
                                long len = Long.reverseBytes(f.readLong());
                                if (type == 0x100 && len > 0 && len < 0x20000) {
                                    byte[] b = new byte[(int) len];
                                    f.seek(off);
                                    f.readFully(b);
                                    ver = new String(b, "UTF-8").trim();
                                    break;
                                }
                            }
                            f.close();
                            if (ver.isEmpty()) {
                                bus.reply(rid, err("version.txt nao encontrado"));
                                return;
                            }
                            JSONObject o = new JSONObject();
                            o.put("ok", true);
                            o.put("version", ver);
                            bus.reply(rid, o);
                        } catch (Throwable e) {
                            bus.reply(rid, err(e.getMessage()));
                        }
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "zipList": {
                final String zpath = arg(a, "path", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            ZipInputStream zin = new ZipInputStream(new FileInputStream(zpath));
                            JSONArray arr = new JSONArray();
                            ZipEntry e;
                            while ((e = zin.getNextEntry()) != null) arr.put(e.getName());
                            zin.close();
                            bus.reply(rid, arr);
                        } catch (Exception ex) {
                            bus.reply(rid, null);
                        }
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "extractZip": {
                final String zip = arg(a, "zip", "");
                final String dest = arg(a, "dest", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        int n = -1;
                        try {
                            n = extractZip(new File(zip), new File(dest));
                        } catch (Exception ignore) {}
                        bus.reply(rid, n >= 0 ? n : -1);
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "fileInfo": {
                final String v = arg(a, "path", "");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        bus.reply(rid, preflight(new File(v)));
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "installVpk": {
                final String v = arg(a, "path", "");
                final String base = arg(a, "base", defaultInstallDir());
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            JSONObject r = installVpk(new File(v), base);
                            bus.reply(rid, r);
                        } catch (Throwable e) {
                            bus.reply(rid, err(e.getMessage() != null ? e.getMessage() : e.toString()));
                        }
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "fwCheck": {
                final String region = arg(a, "region", "us");
                final String rid = id;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            JSONObject info = fetchUpdateInfo(region);
                            android.util.Log.i("VitaHub", "fwCheck region=" + region
                                    + " -> " + (info == null ? "null" : info.toString()));
                            bus.reply(rid, info == null ? err("no-update") : info);
                        } catch (Throwable e) {
                            android.util.Log.e("VitaHub", "fwCheck thread falhou: " + e);
                            bus.reply(rid, err("no-update"));
                        }
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "download": {
                String wantSha = arg(a, "sha256", "");
                long wantSize = -1L;
                long sz = argLong(a, "size", -1L);
                if (sz > 0) wantSize = sz;
                startDownload(arg(a, "url", ""), arg(a, "dest", home + "/fw/PSP2UPDAT.PUP"),
                        id, wantSha.isEmpty() ? null : wantSha, wantSize);
                return;
            }
            case "installPkg": {
                final String ppath = arg(a, "path", "");
                final String zrif = arg(a, "zrif", "");
                final String wbin = arg(a, "workbin", "");
                final String base = arg(a, "base", defaultInstallDir());
                final String rid = id;
Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            File pf = new File(ppath);
                            android.util.Log.i("VitaHub", "installPkg PATH=" + ppath
                                    + " exists=" + pf.exists()
                                    + " isFile=" + pf.isFile()
                                    + " len=" + pf.length()
                                    + " base=" + base);
                            // Cada atualizacao vira um evento "install:progress".
                            // A UI recebe assim um byte a byte em vez de ficar
                            // parada ate o processo inteiro terminar.
                            PkgExtractor.ProgressListener pl =
                                    new PkgExtractor.ProgressListener() {
                                        public void onProgress(final String phase, final long done, final long total) {
                                            try {
                                                JSONObject p = new JSONObject();
                                                p.put("phase", phase);
                                                p.put("done", done);
                                                p.put("total", total);
                                                bus.event("install:progress", p);
                                            } catch (Exception ignore) {
                                            }
                                        }
                                    };
                            Map<String, Object> m = PkgExtractor.install(ppath, zrif, wbin, base, pl);
                            JSONObject r = new JSONObject();
                            for (Map.Entry<String, Object> e : m.entrySet()) r.put(e.getKey(), e.getValue());
                            // O logcat deste aparelho e inutil (AppLog), e a
                            // instalacao so escrevia la. Sem esta linha nao havia
                            // como responder "instalou mas nao aparece": faltava
                            // saber qual base foi usada e o que foi extraido.
                            AppLog.i("install ok: " + r.toString());
                            bus.reply(rid, r);
                        } catch (Throwable e) {
                            android.util.Log.e("VitaHub", "installPkg(" + ppath + ", zrif=" + (zrif != null && !zrif.isEmpty()) + ", wbin=" + wbin + ", base=" + base + ") falhou: " + e);
                            AppLog.e("install falhou (base=" + base + "): " + (e.getMessage() != null ? e.getMessage() : e.toString()), e);
                            bus.reply(rid, err((e.getMessage() != null ? e.getMessage() : e.toString()) + " [pkg=" + ppath + "]"));
                        }
                    }
                });
                t.setDaemon(true);
                t.start();
                return;
            }
            case "launch": {
                String pkg = arg(a, "pkg", DEF_PKG);
                Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                if (i == null) i = getPackageManager().getLaunchIntentForPackage(DEF_PKG2);
                if (i == null) {
                    bus.reply(id, err("Vita3K not installed"));
                    return;
                }
                try {
                    startActivity(i);
                    bus.reply(id, ok());
                } catch (Exception e) {
                    bus.reply(id, err(e.getMessage()));
                }
                return;
            }
            case "launchTitle": {
                String titleId = arg(a, "titleId", "");
                if (titleId.isEmpty()) { bus.reply(id, err("no titleId")); return; }
                try {
                    Intent i = new Intent(this, EngineActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    i.putExtra("AppStartParameters", new String[] { "-r", titleId });
                    // A engine le este extra ao montar o config.yml, para
                    // aplicar os ajustes salvos para este titulo e nao os
                    // globais de outro app.
                    i.putExtra(EngineActivity.EXTRA_TITLE_ID, titleId);
                    startActivity(i);
                    bus.reply(id, ok());
                } catch (Exception e) {
                    bus.reply(id, err(e.getMessage()));
                }
                return;
            }
            case "findEmulators": {
                JSONArray arr = new JSONArray();
                List<String> seen = new ArrayList<String>();
                PackageManager pm = getPackageManager();
                for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
                    String name = ai.packageName;
                    if (!name.toLowerCase().contains("vita")) continue;
                    JSONObject o = new JSONObject();
                    o.put("pkg", name);
                    o.put("label", pm.getApplicationLabel(ai).toString());
                    o.put("installed", true);
                    arr.put(o);
                    seen.add(name);
                }
                if (!seen.contains(DEF_PKG)) {
                    JSONObject o = new JSONObject();
                    o.put("pkg", DEF_PKG);
                    o.put("label", "Vita3K");
                    o.put("installed", false);
                    arr.put(0, o);
                }
                bus.reply(id, arr);
                return;
            }
            case "pickDir":
                if (pendingDirHandlers.isEmpty()) {
                    pendingDirHandlers.add(id);
                } else {
                    // Um seletor ja esta aberto: nao perca a promessa do JS,
                    // apenas cancela a nova e mantem a antiga.
                    bus.reply(id, null);
                    return;
                }
                try {
                    startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                            .addCategory(Intent.CATEGORY_DEFAULT), REQ_DIR);
                } catch (Exception e) {
                    dropPending(pendingDirHandlers);
                    bus.reply(id, null);
                }
                return;
            case "pickFile": {
                if (pendingFileHandlers.isEmpty()) {
                    pendingFileHandlers.add(id);
                } else {
                    bus.reply(id, null);
                    return;
                }
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_FILE);
                } catch (Exception e) {
                    dropPending(pendingFileHandlers);
                    bus.reply(id, null);
                }
                return;
            }
            case "hasAllFiles": {
                boolean has = Build.VERSION.SDK_INT < 30 || Environment.isExternalStorageManager();
                bus.reply(id, has);
                return;
            }
            case "allFilesSettings": {
                if (openAllFilesSettings()) {
                    bus.reply(id, ok());
                } else {
                    bus.reply(id, err("unsupported"));
                }
                return;
            }
            case "readLog": {
                final String which = arg(a, "which", "app");
                final int maxBytes = (int) Math.max(4096L,
                        Math.min(2L * 1024 * 1024, argLong(a, "maxBytes", 262144)));
                final String ridLog = id;
                // Le arquivo grande no thread: o log da engine passa de MB com
                // erro repetido, e o logcat deste aparelho nao e legivel, entao
                // este arquivo e a unica fonte de diagnostico disponivel.
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        try {
                            bus.reply(ridLog, readLogFile(which, maxBytes));
                        } catch (Throwable e) {
                            bus.reply(ridLog, err(String.valueOf(e.getMessage())));
                        }
                    }
                }, "vitahub-read-log");
                t.setDaemon(true);
                t.start();
                return;
            }
            case "lastExit": {
                JSONObject e = lastExit;
                bus.reply(id, e == null ? new JSONObject() : e);
                return;
            }
            case "storageAccess": {
                JSONObject o = new JSONObject();
                o.put("granted", hasStorageAccess());
                // "all-files" = acesso a todos os arquivos (API 30+);
                // "runtime" = dialog de permissao classica (ate o Android 10).
                o.put("mode", Build.VERSION.SDK_INT >= 30 ? "all-files" : "runtime");
                o.put("sdk", Build.VERSION.SDK_INT);
                bus.reply(id, o);
                return;
            }
            case "requestStorageAccess": {
                if (hasStorageAccess()) { bus.reply(id, ok()); return; }
                if (Build.VERSION.SDK_INT >= 30) {
                    // Sem dialogo: o usuario concede numa tela de sistema e o
                    // app so descobre na proxima leitura de storageAccess.
                    bus.reply(id, openAllFilesSettings() ? ok() : err("unsupported"));
                    return;
                }
                if (!pendingPermHandlers.isEmpty()) { bus.reply(id, null); return; }
                pendingPermHandlers.add(id);
                try {
                    requestPermissions(new String[]{
                            android.Manifest.permission.READ_EXTERNAL_STORAGE,
                            android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
                } catch (Exception e) {
                    dropPending(pendingPermHandlers);
                    bus.reply(id, err(String.valueOf(e.getMessage())));
                }
                return;
            }
            case "toast":
                Toast.makeText(this, arg(a, "msg", ""), Toast.LENGTH_LONG).show();
                bus.reply(id, true);
                return;
            case "clipboard": {
                // O log so existe em Android/data, que nem o seletor do
                // Android 11+ nem o gerenciador do aparelho alcancam. Sem isto
                // nao ha caminho de saida para um diagnostico: o usuario teria
                // que dar Print, que ele nao consegue enviar. Vai para a area
                // de transferencia e pronto para colar.
                final String text = arg(a, "text", "");
                boolean ok = false;
                try {
                    android.content.ClipboardManager cm =
                            (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("VitaHub", text));
                        ok = true;
                    }
                } catch (Throwable e) {
                    AppLog.e("clipboard falhou", e);
                }
                bus.reply(id, ok);
                return;
            }
            case "mark":
                // Também no arquivo, não só no logcat: este aparelho enche o
                // logcat com o daemon do MIUI e rotaciona os buffers, então as
                // trilhas de ERR:/screen: sumiam antes de alguem ler. No
                // arquivo elas reconstroem a sequência do boot.
                AppLog.step("mark " + arg(a, "tag", ""));
                bus.reply(id, true);
                return;
            case "cameraTake":
                if (!pendingCameraHandlers.isEmpty()) {
                    bus.reply(id, null);
                    return;
                }
                pendingCameraHandlers.add(id);
                cameraUri = null;
                try {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Images.Media.DISPLAY_NAME, "vitahub_" + System.currentTimeMillis() + ".jpg");
                    cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    if (Build.VERSION.SDK_INT >= 29) {
                        cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/VitaHub");
                    }
                    Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) {
                        dropPending(pendingCameraHandlers);
                        bus.reply(id, err("no media store"));
                        return;
                    }
                    cameraUri = uri;
                    Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    i.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                    i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    startActivityForResult(i, REQ_CAMERA);
                } catch (Exception e) {
                    cameraUri = null;
                    dropPending(pendingCameraHandlers);
                    bus.reply(id, err(e.getMessage()));
                }
                return;
            case "openExternal": {
                String url = arg(a, "url", "");
                if (url.isEmpty()) { bus.reply(id, false); return; }
                bus.reply(id, openExternalUrl(url));
                return;
            }
            case "updateFetch": {
                final String url = arg(a, "url", "");
                final String rid = id;
                final int cap = Math.max(1024, Math.min(4 * 1024 * 1024, (int) argLong(a, "maxBytes", 1024 * 1024)));
                if (!url.startsWith("https://")) { bus.reply(rid, err("somente https")); return; }
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        JSONObject o = new JSONObject();
                        HttpURLConnection c = null;
                        try {
                            c = openNet(url);
                            c.setConnectTimeout(12000);
                            c.setReadTimeout(20000);
                            c.setRequestProperty("Accept", "application/json");
                            c.setRequestProperty("User-Agent", "VitaHub-Android");
                            int st = c.getResponseCode();
                            InputStream in = st >= 400 ? c.getErrorStream() : c.getInputStream();
                            String body = in == null ? "" : readStream(in, cap);
                            put(o, "ok", st >= 200 && st < 300);
                            put(o, "status", st);
                            put(o, "body", body);
                            put(o, "truncated", in != null && body.length() >= cap);
                        } catch (Exception e) {
                            put(o, "ok", false);
                            put(o, "error", String.valueOf(e.getMessage()));
                        } finally {
                            if (c != null) c.disconnect();
                        }
                        bus.reply(rid, o);
                    }
                });
                t.start();
                return;
            }
            case "updateDownload": {
                final String url = arg(a, "url", "");
                final String rid = id;
                if (!url.startsWith("https://")) { bus.reply(rid, err("somente https")); return; }
                String name = arg(a, "name", "");
                name = name.replaceAll("[^A-Za-z0-9._-]", "_");
                if (name.isEmpty() || !name.toLowerCase().endsWith(".apk")) name = "VitaHub-update.apk";
                final String fname = name;
                Thread t = new Thread(new Runnable() {
                    public void run() {
                        File dir = getExternalFilesDir("update");
                        JSONObject o = new JSONObject();
                        if (dir == null) { put(o, "ok", false); put(o, "error", "sem armazenamento externo"); bus.reply(rid, o); return; }
                        if (!dir.isDirectory() && !dir.mkdirs()) { put(o, "ok", false); put(o, "error", "mkdir falhou"); bus.reply(rid, o); return; }
                        File tmp = new File(dir, fname + ".part");
                        File dst = new File(dir, fname);
                        HttpURLConnection c = null;
                        InputStream in = null;
                        OutputStream out = null;
                        try {
                            c = openNet(url);
                            c.setConnectTimeout(20000);
                            c.setReadTimeout(60000);
                            c.setInstanceFollowRedirects(true);
                            c.setRequestProperty("User-Agent", "VitaHub-Android");
                            int st = c.getResponseCode();
                            if (st < 200 || st >= 300) throw new IOException("HTTP " + st);
                            long total = c.getContentLength();
                            in = c.getInputStream();
                            out = new FileOutputStream(tmp);
                            byte[] buf = new byte[64 * 1024];
                            long got = 0, lastPct = -1;
                            int n;
                            while ((n = in.read(buf)) > 0) {
                                out.write(buf, 0, n);
                                got += n;
                                int pct = total > 0 ? (int) (got * 100 / total) : -1;
                                if (pct >= 0 && pct != lastPct && pct % 2 == 0) {
                                    lastPct = pct;
                                    try {
                                        JSONObject p = new JSONObject();
                                        p.put("pct", pct);
                                        p.put("got", got);
                                        p.put("total", total);
                                        bus.event("update:progress", p);
                                    } catch (Exception ignore) { }
                                }
                            }
                            out.flush();
                            out.close();
                            out = null;
                            if (total > 0 && got != total) throw new IOException("download incompleto (" + got + "/" + total + ")");
                            if (tmp.length() < 1024) throw new IOException("arquivo pequeno demais");
                            if (dst.exists() && !dst.delete()) throw new IOException("nao replacei o apk antigo");
                            if (!tmp.renameTo(dst)) throw new IOException("rename falhou");
                            put(o, "ok", true);
                            put(o, "path", dst.getAbsolutePath());
                            put(o, "name", dst.getName());
                            put(o, "size", dst.length());
                        } catch (Exception e) {
                            try { if (out != null) out.close(); } catch (Exception ignore) { }
                            if (tmp.exists()) tmp.delete();
                            put(o, "ok", false);
                            put(o, "error", String.valueOf(e.getMessage()));
                        } finally {
                            if (c != null) c.disconnect();
                        }
                        bus.reply(rid, o);
                    }
                });
                t.start();
                return;
            }
            case "updateInstallPerm": {
                JSONObject o = new JSONObject();
                boolean allowed = true;
                try {
                    allowed = Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
                } catch (Throwable e) {
                    allowed = true;
                }
                o.put("ok", true);
                o.put("allowed", allowed);
                bus.reply(id, o);
                return;
            }
            case "updateInstallPermAsk": {
                // A constante Settings.ACTION_MANAGE_APP_INSTALL_PACKAGES nao
                // existe no android.jar deste SDK, entao a action vai como
                // literal (mesmo valor do AOSP) e a tela global fica de reserva.
                try {
                    Intent i = new Intent("android.settings.MANAGE_APP_INSTALL_PACKAGES", Uri.parse("package:" + getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                    bus.reply(id, ok());
                } catch (Exception e) {
                    try {
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        bus.reply(id, ok());
                    } catch (Exception e2) {
                        bus.reply(id, err(String.valueOf(e2.getMessage())));
                    }
                }
                return;
            }
            case "updateInstall": {
                String path = arg(a, "path", "");
                String name = arg(a, "name", "");
                if (name.isEmpty() && !path.isEmpty()) {
                    int k = path.lastIndexOf('/');
                    name = k >= 0 ? path.substring(k + 1) : path;
                }
                if (name.isEmpty()) { bus.reply(id, err("sem arquivo")); return; }
                boolean allowed = true;
                try {
                    allowed = Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
                } catch (Throwable e) {
                    allowed = true;
                }
                if (!allowed) { bus.reply(id, err("permissao de instalar ausente")); return; }
                try {
                    Uri u = new Uri.Builder()
                            .scheme("content")
                            .authority(UpdateProvider.AUTHORITY)
                            .appendPath(name)
                            .build();
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(u, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                    bus.reply(id, ok());
                } catch (Exception e) {
                    bus.reply(id, err(String.valueOf(e.getMessage())));
                }
                return;
            }
            case "openWith": {
                String u = arg(a, "uri", "");
                String p = arg(a, "path", "");
                Uri target = null;
                if (!p.isEmpty()) {
                    String mapped = uriByPath.get(p);
                    if (mapped != null) target = Uri.parse(mapped);
                }
                if (target == null && !u.isEmpty()) target = Uri.parse(u);
                if (target == null) target = lastPickedUri;
                if (target == null) { bus.reply(id, err("no uri")); return; }
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(target, "application/octet-stream");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(i);
                    bus.reply(id, ok());
                } catch (Exception e) {
                    bus.reply(id, err(e.getMessage()));
                }
                return;
            }
            case "toggleUI":
                immersive = !immersive;
                if (immersive) hideSystemUI(); else showSystemUI();
                bus.reply(id, immersive);
                return;
            case "quit":
                moveTaskToBack(true);
                finish();
                bus.reply(id, true);
                return;
            default:
                bus.reply(id, err("unknown method " + method));
        }
    }

    private static boolean deleteRec(File f) {
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRec(k);
        }
        return f.delete();
    }

    /**
     * Resolve com "cancelado" qualquer id de seletor que ficou pendente (o seletor
     * nem chegou a abrir, ou a Activity foi recriada). Sem isso a promessa do JS
     * ficaria pendurada para sempre e a tela travava sem nenhuma mensagem.
     */
    private void dropPending(List<String> pending) {
        while (!pending.isEmpty()) bus.reply(pending.remove(0), null);
    }

    private static boolean ensureNativeSession(String storagePath) {
        synchronized (NATIVE_LOCK) {
            if (nativeSessionState != null) return nativeSessionState.booleanValue();
            boolean ok = doEnsureNativeSession(storagePath);
            nativeSessionState = Boolean.valueOf(ok);
            return ok;
        }
    }

    private static boolean doEnsureNativeSession(String storagePath) {
        try {
            System.loadLibrary("Vita3K");
        } catch (Throwable e) {
            AppLog.w("ensureNativeSession: loadLibrary(Vita3K): " + e);
        }
        try {
            Class<?> clazz = Class.forName("org.vita3k.emulator.NativeLib");
            Constructor<?> ctor = clazz.getDeclaredConstructor();
            ctor.setAccessible(true);
            Object instance = ctor.newInstance();
            if ((Boolean) clazz.getDeclaredMethod("isInitialized").invoke(instance)) {
                return true;
            }
            long t0 = System.currentTimeMillis();
            boolean ok = (Boolean) clazz.getDeclaredMethod("init", String.class).invoke(instance, storagePath);
            AppLog.step("ensureNativeSession: NativeLib.init = " + ok
                    + " em " + (System.currentTimeMillis() - t0) + "ms");
            return ok;
        } catch (Throwable error) {
            AppLog.e("ensureNativeSession falhou", error);
            return false;
        }
    }

    private void startFirmwareInstall(final String pup, final String rid) {
        Thread t = new Thread(new Runnable() {
            public void run() {
                String ver;
                long t0 = System.currentTimeMillis();
                try {
                    synchronized (FW_INSTALL_LOCK) {
                        if (!ensureNativeSession(externalRoot().getAbsolutePath())) {
                            AppLog.e("fwInstall: ensureNativeSession falhou", null);
                            bus.reply(rid, err("falha ao iniciar a sessao nativa do emulador"));
                            return;
                        }
                        ver = installFirmwareNative(pup);
                    }
                } catch (Throwable e) {
                    AppLog.e("fwInstall: installFirmwareNative threw", e);
                    bus.reply(rid, err("erro ao extrair o firmware: " + e));
                    return;
                }
                AppLog.step("fwInstall: terminou em " + (System.currentTimeMillis() - t0)
                        + "ms versao=" + ver);
                if (ver == null || ver.isEmpty()) {
                    bus.reply(rid, err("extra\u00e7\u00e3o do firmware falhou"));
                    return;
                }
                try {
                    JSONObject o = new JSONObject();
                    o.put("ok", true);
                    o.put("version", ver);
                    bus.reply(rid, o);
                } catch (Exception e) {
                    bus.reply(rid, err("falha interna"));
                }
            }
        }, "vitahub-fw-install");
        t.setDaemon(true);
        t.start();
    }

    private static String installFirmwareNative(String path) {
        try {
            Class<?> cbClass = Class.forName("org.vita3k.emulator.data.InstallCallback");
            Class<?> clazz = Class.forName("org.vita3k.emulator.NativeLib");
            Constructor<?> ctor = clazz.getDeclaredConstructor();
            ctor.setAccessible(true);
            Object instance = ctor.newInstance();
            final java.lang.reflect.Method onProgress = cbClass.getDeclaredMethod("onProgress", int.class, String.class);
            Object callback = java.lang.reflect.Proxy.newProxyInstance(
                    clazz.getClassLoader(),
                    new Class<?>[] { cbClass },
                    new java.lang.reflect.InvocationHandler() {
                        public Object invoke(Object proxy, java.lang.reflect.Method m, Object[] args) {
                            try {
                                if (m.equals(onProgress) && args != null && args.length >= 2) {
                                    Log.i("VitaHub", "fwInstall " + args[0] + "% " + args[1]);
                                }
                            } catch (Throwable ignore) {}
                            return null;
                        }
                    });
            java.lang.reflect.Method m = clazz.getDeclaredMethod("installFirmware", String.class, cbClass);
            Object r = m.invoke(instance, path, callback);
            return r == null ? "" : String.valueOf(r);
        } catch (Throwable error) {
            Log.e("VitaHub", "installFirmwareNative falhou", error);
            return "";
        }
    }

    private static String readAll(File f) throws Exception {
        long len = f.length();
        if (len <= 0 || len > MAX_TEXT_FILE) throw new Exception("arquivo grande demais para leitura de texto");
        byte[] b = new byte[(int) len];
        FileInputStream in = new FileInputStream(f);
        try {
            int got = 0;
            while (got < b.length) {
                int r = in.read(b, got, b.length - got);
                if (r < 0) break;
                got += r;
            }
            if (got != b.length) {
                byte[] c = new byte[got];
                System.arraycopy(b, 0, c, 0, got);
                b = c;
            }
        } finally {
            in.close();
        }
        return new String(b, "UTF-8");
    }

    private static boolean isPng(byte[] b) {
        return b.length >= 8
            && (b[0] & 0xFF) == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
            && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A;
    }

    /** Le um PNG para base64, ou null se nao existir/nao for PNG/grandes demais. */
    /** Remove uma arvore de arquivos. Silencioso em no-arquivos. */
    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) {
                for (int i = 0; i < kids.length; i++) deleteTree(kids[i]);
            }
        }
        if (!f.delete() && f.exists()) {
            f.deleteOnExit();
        }
    }

    /** Soma o tamanho em bytes de uma arvore, sem materializar nada. */
    private static long dirSize(File d) {
        long total = 0;
        if (d == null || !d.exists()) return 0;
        if (d.isFile()) return d.length();
        File[] kids = d.listFiles();
        if (kids == null) return 0;
        for (int i = 0; i < kids.length; i++) {
            File k = kids[i];
            total += k.isDirectory() ? dirSize(k) : k.length();
        }
        return total;
    }

    /**
     * Metadados de um app instalado, para a aba "Info". Campos ausentes no
     * param.sfo voltam vazios: e melhor uma linha em branco do que a tela
     * inteira quebrada por um PKG de PS Vita mais antigo.
     */
    private static JSONObject appInfoJson(String appDir) {
        JSONObject o = new JSONObject();
        File dir = new File(appDir);
        if (!dir.isDirectory()) return err("pasta do app nao encontrada");
        String sfo = new File(dir, "sce_sys/param.sfo").getPath();
        java.util.Map<String, Object> m = PkgExtractor.readParamInfo(sfo);
        put(o, "title", sfoStr(m, "TITLE", "TITLE_00"));
        put(o, "titleId", sfoStr(m, "TITLE_ID"));
        put(o, "version", sfoStr(m, "VERSION"));
        put(o, "contentId", sfoStr(m, "CONTENT_ID"));
        put(o, "category", sfoStr(m, "CATEGORY"));
        put(o, "publisher", sfoStr(m, "PUBLISHER_NAME", "PUBLISHER"));
        put(o, "description", sfoStr(m, "LONG_DESCRIPTION", "DESCRIPTION"));
        put(o, "releaseDate", sfoStr(m, "RELEASE_DATE"));
        put(o, "size", dirSize(dir));
        put(o, "installed", dir.lastModified());
        put(o, "path", dir.getPath());
        put(o, "hasIcon", new File(dir, "sce_sys/icon0.png").isFile());
        put(o, "hasEboot", new File(dir, "eboot.bin").isFile());
        put(o, "hasPbp", new File(dir, "EBOOT.PBP").isFile());
        return o;
    }

    private static String sfoStr(java.util.Map<String, Object> m, String... keys) {
        for (int i = 0; i < keys.length; i++) {
            Object v = m.get(keys[i]);
            if (v == null) continue;
            String s = String.valueOf(v).replace("\u0000", "").trim();
            if (!s.isEmpty()) return s;
        }
        return "";
    }

    private static String readPngAsBase64(File f) {
        if (!f.isFile() || f.length() <= 8 || f.length() > MAX_BASE64_FILE) return null;
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int r;
            while ((r = in.read(buf)) > 0) bos.write(buf, 0, r);
            byte[] raw = bos.toByteArray();
            if (raw.length < 8 || !isPng(raw)) return null;
            return Base64.encodeToString(raw, Base64.NO_WRAP);
        } catch (Throwable e) {
            return null;
        } finally {
            if (in != null) try { in.close(); } catch (Throwable ignore) {}
        }
    }

    private static long duRec(File f) {
        if (f == null) return 0L;
        try {
            if (f.isFile()) return f.length();
            File[] kids = f.listFiles();
            if (kids == null) return 0L;
            long t = 0L;
            for (File k : kids) t += duRec(k);
            return t;
        } catch (Throwable ignore) {
            return 0L;
        }
    }

    /**
     * Copia recursiva. {@code st} e o JSONObject de progresso que se reusa como
     * estado entre os arquivos (bytes, contagem e o marcador da ultima emission),
     * para nao alocar um objeto por arquivo.
     */
    private JSONObject copyTree(File src, File dst, long[] done, long total, JSONObject st) {
        try {
            if (src.isDirectory()) {
                if (!dst.isDirectory() && !dst.mkdirs()) {
                    st.put("ok", Boolean.FALSE);
                    st.put("error", "sem permissao para criar " + dst.getAbsolutePath());
                    return st;
                }
                File[] kids = src.listFiles();
                if (kids == null) {
                    st.put("ok", Boolean.FALSE);
                    st.put("error", "nao foi possivel ler " + src.getAbsolutePath());
                    return st;
                }
                for (File k : kids) {
                    copyTree(k, dst, done, total, st);
                    if (!st.optBoolean("ok", true)) return st;
                }
                return st;
            }
            if (!copyFile(src, dst)) {
                st.put("ok", Boolean.FALSE);
                st.put("error", "falhou " + src.getAbsolutePath());
                return st;
            }
            done[0] += src.length();
            st.put("bytes", done[0]);
            st.put("files", st.optLong("files", 0L) + 1L);
            long since = done[0] - st.optLong("since", 0L);
            if (since >= 262144L) {     // 256 KB
                st.put("since", done[0]);
                st.put("total", total);
                bus.event("migrate:progress", st);
            }
            return st;
        } catch (Throwable e) {
            // O proprio catch pode lancar: JSONObject.put declara JSONException
            // e um catch nao se protege sozinho. Sem este try, uma falha de disco
            // viraria um erro de compilacao em vez de um erro de arquivo.
            try {
                st.put("ok", Boolean.FALSE);
                st.put("error", String.valueOf(e.getMessage()));
            } catch (Throwable ignore) {
            }
            return st;
        }
    }

    private static boolean copyFile(File src, File dst) {
        try {
            if (dst.getParentFile() != null) dst.getParentFile().mkdirs();
            InputStream in = new FileInputStream(src);
            OutputStream os = new FileOutputStream(dst);
            byte[] b = new byte[65536];
            int r;
            while ((r = in.read(b)) > 0) os.write(b, 0, r);
            os.close();
            in.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static int extractZip(File zip, File dest) throws Exception {
        dest.mkdirs();
        ZipInputStream zin = new ZipInputStream(new FileInputStream(zip));
        byte[] buf = new byte[65536];
        int count = 0;
        ZipEntry e;
        while ((e = zin.getNextEntry()) != null) {
            String name = e.getName().replace('\\', '/');
            if (name.startsWith("/") || name.contains("../")) continue;
            File out = new File(dest, name);
            if (e.isDirectory()) {
                out.mkdirs();
                continue;
            }
            if (out.getParentFile() != null) out.getParentFile().mkdirs();
            OutputStream os = new FileOutputStream(out);
            int r;
            while ((r = zin.read(buf)) > 0) os.write(buf, 0, r);
            os.close();
            count++;
        }
        zin.close();
        return count;
    }

    private static final java.util.regex.Pattern VPK_TID =
            java.util.regex.Pattern.compile("^(?:ux0:/app/|ux0:app/|app/)?([A-Z0-9]{9})[/\\\\]");

    private static void writeSmall(File f, byte[] body) throws Exception {
        if (f.getParentFile() != null) f.getParentFile().mkdirs();
        FileOutputStream os = new FileOutputStream(f);
        os.write(body);
        os.close();
    }

    // Reconhece o arquivo escolhido ANTES de instalar. Um download pela metade
    // ja falhava, mas o sintoma era um ZipException cru do java.util.zip, que
    // parece defeito do app em vez de "o download nao terminou". Aqui a falha
    // vira frase, e o sha1 fica registrado para a proxima instalacao comparar.
    private JSONObject preflight(File f) {
        JSONObject o = new JSONObject();
        try {
            if (f == null || !f.isFile()) {
                o.put("ok", false);
                o.put("error", "arquivo nao encontrado");
                return o;
            }
            long size = f.length();
            o.put("size", size);

            MessageDigest md = MessageDigest.getInstance("SHA-1");
            FileInputStream in = new FileInputStream(f);
            try {
                byte[] buf = new byte[131072];
                int r;
                while ((r = in.read(buf)) > 0) md.update(buf, 0, r);
            } finally {
                in.close();
            }
            StringBuilder sb = new StringBuilder();
            byte[] dg = md.digest();
            for (int i = 0; i < dg.length; i++) {
                if (i > 0) sb.append(':');
                String h = Integer.toHexString(dg[i] & 0xff).toUpperCase();
                if (h.length() < 2) sb.append('0');
                sb.append(h);
            }
            o.put("sha1", sb.toString());

            // Estrutura. ZipFile so abre se o diretorio central estiver inteiro
            // e os CRCs conferirem, entao falhar aqui e o sinal honesto de
            // arquivo truncado -- e nao de VPK invalido.
            if (size < 22) {
                o.put("ok", false);
                o.put("error", "arquivo muito pequeno para ser um pacote (" + size + " bytes) - download incompleto?");
                return o;
            }
            ZipFile zf = null;
            try {
                zf = new ZipFile(f);
                int n = 0;
                java.util.Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) { en.nextElement(); n++; }
                o.put("entries", n);
                if (n == 0) {
                    o.put("ok", false);
                    o.put("error", "pacote sem nenhum arquivo - download incompleto?");
                    return o;
                }
            } catch (Exception ze) {
                o.put("ok", false);
                o.put("error", "pacote corrompido ou incompleto (" + (size / 1024) + " KB) - o download probably parou no meio; baixe de novo");
                o.put("detail", ze.getMessage() != null ? ze.getMessage() : ze.toString());
                return o;
            } finally {
                if (zf != null) try { zf.close(); } catch (Exception ignore) {}
            }
            o.put("ok", true);
        } catch (Throwable e) {
            try {
                o.put("ok", false);
                o.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
            } catch (Exception ignore) {}
        }
        return o;
    }

    private JSONObject installVpk(File zip, String baseDir) throws Exception {
        if (zip == null || !zip.isFile()) throw new Exception("arquivo VPK n\u00e3o encontrado");
        if (baseDir == null || baseDir.isEmpty()) throw new Exception("diret\u00f3rio de instala\u00e7\u00e3o n\u00e3o definido");
        // Antes de extrair qualquer coisa, confirma que o pacote esta inteiro.
        // Sem isto, um download pela metade chega ao ZipFile e volta como
        // ZipException cru -- indistinguivel de VPK corrompido de verdade.
        JSONObject pre = preflight(zip);
        if (!pre.optBoolean("ok", false)) {
            throw new Exception(pre.optString("error", "pacote invalido"));
        }
        ZipFile zf = new ZipFile(zip);
        try {
            java.util.Enumeration<? extends ZipEntry> en = zf.entries();
            List<ZipEntry> all = new ArrayList<ZipEntry>();
            String strip = null;
            String titleId = null;
            String sfoEntry = null;
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (e.isDirectory()) continue;
                String n = e.getName().replace('\\', '/');
                all.add(e);
                if (strip == null) {
                    Matcher m = VPK_TID.matcher(n);
                    if (m.find()) {
                        titleId = m.group(1);
                        String pref = n.substring(0, m.start(1));
                        strip = pref + titleId + "/";
                    }
                }
                if (sfoEntry == null && n.endsWith("sce_sys/param.sfo")) sfoEntry = n;
            }
            String sfoTmp = null;
            if (titleId == null && sfoEntry != null) {
                ZipEntry ze = zf.getEntry(sfoEntry);
                File tmp = File.createTempFile("vitahub_sfo", ".sfo");
                InputStream in = zf.getInputStream(ze);
                OutputStream os = new FileOutputStream(tmp);
                byte[] b = new byte[65536];
                int r;
                while ((r = in.read(b)) > 0) os.write(b, 0, r);
                os.close();
                in.close();
                sfoTmp = tmp.getAbsolutePath();
                String tid = PkgExtractor.readParamTitleId(sfoTmp);
                if (tid != null && !tid.isEmpty()) titleId = tid;
            }
            if (titleId == null) throw new Exception("VPK sem TITLE_ID (param.sfo ausente ou inv\u00e1lido)");

            File destDir = new File(baseDir, "ux0/app/" + titleId);
            if (!destDir.isDirectory() && !destDir.mkdirs()) throw new Exception("n\u00e3o foi poss\u00edvel criar " + destDir);
            int count = 0;
            for (ZipEntry e : all) {
                String n = e.getName().replace('\\', '/');
                String rel;
                if (strip != null) {
                    if (!n.startsWith(strip)) continue;
                    rel = n.substring(strip.length());
                } else {
                    Matcher m = VPK_TID.matcher(n);
                    if (m.find()) rel = n.substring(m.end());
                    else rel = n;
                }
                if (rel == null || rel.isEmpty()) continue;
                if (rel.startsWith("/") || rel.contains("../")) continue;
                File out = new File(destDir, rel);
                if (out.getParentFile() != null) out.getParentFile().mkdirs();
                InputStream in = zf.getInputStream(e);
                OutputStream os = new FileOutputStream(out);
                byte[] b = new byte[65536];
                int r;
                while ((r = in.read(b)) > 0) os.write(b, 0, r);
                os.close();
                in.close();
                count++;
            }
            if (count == 0) throw new Exception("VPK sem arquivos v\u00e1lidos para extrair");
            String title = "";
            try {
                if (sfoTmp != null) title = PkgExtractor.readParamTitle(sfoTmp);
                else title = PkgExtractor.readParamTitle(new File(destDir, "sce_sys/param.sfo").getAbsolutePath());
            } catch (Throwable ignore) {}
            try {
                writeSmall(new File(destDir, "sce_sys/package/_install.json"),
                        ("{\"titleId\":\"" + titleId + "\",\"kind\":\"vita\",\"mode\":\"vpk\",\"files\":" + count + "}")
                                .getBytes("UTF-8"));
            } catch (Throwable ignore) {}
            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("mode", "standalone");
            r.put("kind", "vita");
            r.put("titleId", titleId);
            r.put("title", title);
            r.put("appDir", destDir.getAbsolutePath());
            r.put("files", Integer.valueOf(count));
            return r;
        } finally {
            zf.close();
        }
    }

    // ------------------------- Sony firmware check -------------------------
    private static String extractAttr(String attrs, String name) {
        Matcher m = Pattern.compile("(?i)\\b" + name + "\\s*=\\s*\"([^\"]*)\"").matcher(attrs);
        if (!m.find()) return null;
        return m.group(1).replace("&amp;", "&");
    }

    private static String fwHost(String region) {
        String r = (region == null ? "us" : region).toLowerCase();
        if (r.equals("jp")) return "djp01";
        if (r.equals("eu")) return "deu01";
        if (r.equals("tw")) return "dtw01";
        if (r.equals("kr")) return "dkr01";
        if (r.equals("au")) return "dau01";
        if (r.equals("gb")) return "dgb01";
        return "dus01";
    }

    // The font package PUP (sa0 fonts) is served by Sony but not listed in the
    // updatelist; this known-good build (2019_0924) carries it (see Vita3K #2977).
    private static String fontPupUrl(String region) {
        String r = (region == null ? "us" : region).toLowerCase();
        return "https://" + fwHost(region)
                + ".psp2.update.playstation.net/update/psp2/image/2019_0924/sd_8b5f60b56c3da8365b973dba570c53a5/PSP2UPDAT.PUP?dest=" + r;
    }

    private JSONObject fetchUpdateInfo(String region) {
        String r = region == null ? "us" : region;
        String url = "https://" + fwHost(r) + ".psp2.update.playstation.net/update/psp2/list/"
                + r + "/psp2-updatelist.xml";
        try {
            HttpURLConnection c = openNet(url);
            c.setConnectTimeout(12000);
            c.setReadTimeout(12000);
            c.setRequestProperty("User-Agent", "VitaHub/0.1");
            if (c.getResponseCode() != 200) return null;
            BufferedReader rd = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = rd.readLine()) != null) {
                if (sb.length() > 600000) break;
                sb.append(line).append('\n');
            }
            rd.close();
            c.disconnect();
            android.util.Log.i("VitaHub", "fwCheck http " + c.getResponseCode() + " url=" + url + " bytes=" + sb.length());
            String xml = sb.toString();

            String fullUrl = null, fullSize = null;
            Matcher full = Pattern.compile("<update_data\\b[^>]*>([\\s\\S]*?)</update_data>", Pattern.DOTALL).matcher(xml);
            while (full.find()) {
                Matcher im = Pattern.compile("<image\\b([^>]*)>([\\s\\S]*?)</image>", Pattern.DOTALL).matcher(full.group(1));
                if (im.find()) {
                    fullUrl = im.group(2).trim();
                    String sz = extractAttr(im.group(1), "size");
                    if (sz != null) fullSize = sz;
                    break;
                }
            }
            if (fullUrl == null) return null;

            String preUrl = null, preSize = null;
            Matcher rec = Pattern.compile("<recovery\\b([^>]*)>([\\s\\S]*?)</recovery>", Pattern.DOTALL).matcher(xml);
            while (rec.find()) {
                String spkg = extractAttr(rec.group(1), "spkg_type");
                if (spkg == null || !spkg.equals("preinst")) continue;
                Matcher im = Pattern.compile("<image\\b([^>]*)>([\\s\\S]*?)</image>", Pattern.DOTALL).matcher(rec.group(2));
                if (im.find()) {
                    preUrl = im.group(2).trim();
                    String sz = extractAttr(im.group(1), "size");
                    if (sz != null) preSize = sz;
                }
                break;
            }

            String ver = null;
            Matcher vm = Pattern.compile("<version\\b([^>]*)>", Pattern.DOTALL).matcher(xml);
            if (vm.find()) ver = extractAttr(vm.group(1), "label");

            JSONObject o = new JSONObject();
            o.put("ok", true);
            JSONObject info = new JSONObject();
            info.put("url", fullUrl);
            info.put("size", fullSize == null ? JSONObject.NULL : Long.parseLong(fullSize));
            info.put("version", ver == null ? "3.74" : ver);
            JSONObject pre = new JSONObject();
            pre.put("url", preUrl == null ? JSONObject.NULL : preUrl);
            pre.put("size", preSize == null ? JSONObject.NULL : Long.parseLong(preSize));
            info.put("pre", pre);
            JSONObject font = new JSONObject();
            font.put("url", fontPupUrl(r));
            // Sem tamanho: o PUP de fonte nao vem na lista da Sony, e um
            // numero chutado aqui viraria uma verificacao de integridade que
            // reprova o proprio arquivo bom.
            font.put("size", JSONObject.NULL);
            info.put("font", font);
            o.put("info", info);
            return o;
        } catch (Exception e) {
            android.util.Log.i("VitaHub", "fwCheck ERR " + e.getClass().getSimpleName() + ": " + e.getMessage() + " url=" + url);
            return null;
        }
    }

    private void startDownload(final String url, final String dest, final String id) {
        startDownload(url, dest, id, null, -1L);
    }

    /**
     * Baixa um arquivo conferindo integridade contra o que o servidor
     * declarou. HTTPS sozinho garante de onde o byte veio, nao o que ele e: um
     * PUP truncado por conexao ruim, ou substituido por outro arquivo valido
     * (cache de proxy, DNS local), chegava integro do ponto de vista do TLS e
     * era gravado como firmware.
     *
     * @param sha256 esperado em hex, ou null para nao fixar
     * @param size   tamanho esperado em bytes, ou -1 se desconhecido
     */
    private void startDownload(final String url, final String dest, final String id,
                               final String wantSha, final long wantSize) {
        Thread t = new Thread(new Runnable() {
            public void run() { downloadRun(url, dest, id, wantSha, wantSize); }
        });
        t.setDaemon(true);
        t.start();
    }

    private void downloadRun(String url, String dest, String id, String wantSha, long wantSize) {
        try {
            android.util.Log.i("VitaHub", "download url=" + url + " dest=" + dest);
            HttpURLConnection c = openNet(url);
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "VitaHub/0.1");
            int code = c.getResponseCode();
            if (code != 200) {
                bus.reply(id, err("HTTP " + code));
                return;
            }
            long total = c.getContentLengthLong();
            File f = new File(dest);
            if (f.getParentFile() != null) f.getParentFile().mkdirs();
            // Arquivo temporario: o destino so recebe o PUP depois da
            // conferencia, para um download cortado nao deixar um firmware
            // corrompido no lugar do bom.
            File tmp = new File(dest + ".part");
            InputStream in = c.getInputStream();
            FileOutputStream os = new FileOutputStream(tmp);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[65536];
            long read = 0, lastReport = 0;
            long t0 = System.currentTimeMillis(), lastT = t0, lastB = 0;
            int r;
            while ((r = in.read(buf)) > 0) {
                os.write(buf, 0, r);
                md.update(buf, 0, r);
                read += r;
                long now = System.currentTimeMillis();
                if (read - lastReport > 65536 * 8 || read >= total) {
                    lastReport = read;
                    double secs = (now - lastT) / 1000.0;
                    long speed = secs > 0 ? (long) ((read - lastB) / secs) : 0;
                    lastT = now;
                    lastB = read;
                    JSONObject p = new JSONObject();
                    p.put("bytes", read);
                    if (total > 0) p.put("total", total);
                    p.put("pct", total > 0 ? (long) (read * 100 / total) : 0L);
                    p.put("speed", speed);
                    bus.event("fw:progress", p);
                }
            }
            os.close();
            in.close();
            c.disconnect();

            String gotSha = hex(md.digest());
            android.util.Log.i("VitaHub", "download sha256=" + gotSha + " bytes=" + read);

            if (wantSize > 0 && read != wantSize) {
                deleteRec(tmp);
                bus.reply(id, err("download incompleto: " + read + " de " + wantSize + " bytes"));
                return;
            }
            if (wantSha != null && wantSha.length() == 64 && !wantSha.equalsIgnoreCase(gotSha)) {
                deleteRec(tmp);
                bus.reply(id, err("SHA-256 divergente do esperado"));
                return;
            }
            if (!replaceFile(tmp, f)) {
                bus.reply(id, err("nao foi possivel gravar " + dest));
                return;
            }
            JSONObject fin = new JSONObject();
            fin.put("bytes", read);
            fin.put("total", total > 0 ? total : read);
            fin.put("pct", 100);
            fin.put("sha256", gotSha);
            bus.event("fw:progress", fin);
            bus.reply(id, dest);
        } catch (Exception e) {
            bus.reply(id, err(e.getMessage()));
        }
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (int i = 0; i < b.length; i++) sb.append(String.format("%02x", b[i]));
        return sb.toString();
    }

    private static boolean replaceFile(File from, File to) {
        try {
            if (to.exists() && !to.delete()) return false;
            return from.renameTo(to);
        } catch (Exception e) {
            return false;
        }
    }
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_PERM) return;
        for (String pid : pendingPermHandlers) {
            bus.reply(pid, hasStorageAccess() ? ok() : err("denied"));
        }
        pendingPermHandlers.clear();
    }

    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CAMERA) {
            if (!pendingCameraHandlers.isEmpty()) {
                String id = pendingCameraHandlers.remove(0);
                if (resultCode == RESULT_OK && cameraUri != null) {
                    String path = snapshotCamera(cameraUri);
                    if (path != null) {
                        try {
                            getContentResolver().delete(cameraUri, null, null);
                        } catch (Exception ignore) {}
                        bus.reply(id, path);
                    } else {
                        bus.reply(id, err("camera failed"));
                    }
                } else {
                    bus.reply(id, null);
                }
            }
            cameraUri = null;
            return;
        }
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (requestCode == REQ_DIR && !pendingDirHandlers.isEmpty())
                bus.reply(pendingDirHandlers.remove(0), null);
            else if (requestCode == REQ_FILE && !pendingFileHandlers.isEmpty())
                bus.reply(pendingFileHandlers.remove(0), null);
            return;
        }
        if (requestCode == REQ_DIR) resolveDir(data);
        else if (requestCode == REQ_FILE) resolveFile(data);
    }

    private String snapshotCamera(Uri uri) {
        try {
            String base = defaultInstallDir();
            File dir = new File(base, "photos");
            dir.mkdirs();
            File out = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            OutputStream os = new FileOutputStream(out);
            byte[] buf = new byte[65536];
            int r;
            while ((r = in.read(buf)) > 0) os.write(buf, 0, r);
            os.close();
            in.close();
            return out.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    private void resolveDir(Intent data) {
        String id = pendingDirHandlers.isEmpty() ? null : pendingDirHandlers.remove(0);
        if (id == null) return;
        try {
            Uri uri = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignore) {}
            String docId = DocumentsContract.getTreeDocumentId(uri);
            String[] parts = docId.split(":", 2);
            String base = "primary".equals(parts[0]) ? "/storage/emulated/0" : "/storage/" + parts[0];
            String rel = parts.length > 1 ? parts[1] : "";
            String path = rel.isEmpty() ? base : base + "/" + rel;
            if (probeWritable(path)) {
                bus.reply(id, path);
            } else {
                String dflt = defaultInstallDir();
                toast("Diretorio nao gravavel; usando " + dflt);
                bus.reply(id, dflt);
            }
        } catch (Exception e) {
            bus.reply(id, null);
        }
    }

    private void resolveFile(Intent data) {
        String id = pendingFileHandlers.isEmpty() ? null : pendingFileHandlers.remove(0);
        if (id == null) return;
        try {
            final Uri uri = data.getData();
            if (uri == null) { bus.reply(id, null); return; }
            try {
                getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignore) {}
            lastPickedUri = uri;

            // SAF entrega um content:// para o mesmo arquivo do /sdcard. Quando
            // ele tem caminho de verdade, devolver esse caminho e' o que evita
            // copiar gigabytes para getFilesDir() antes de so responder.
            String real = realPathFor(uri);
            if (real != null) {
                uriByPath.put(real, uri.toString());
                bus.reply(id, real);
                return;
            }

            String name = queryDisplayName(uri);
            name = (name == null || name.isEmpty()) ? ("import_" + System.currentTimeMillis()) : name;
            name = name.replaceAll("[\\\\/]", "_");
            File dir = new File(getFilesDir(), "importer");
            dir.mkdirs();
            final File out = new File(dir, name);
            uriByPath.put(out.getAbsolutePath(), uri.toString());
            final String rid = id;
            Thread t = new Thread(new Runnable() {
                public void run() {
                    try {
                        InputStream in = getContentResolver().openInputStream(uri);
                        if (in == null) { bus.reply(rid, null); return; }
                        OutputStream os = new FileOutputStream(out);
                        byte[] b = new byte[262144];
                        int r;
                        while ((r = in.read(b)) > 0) os.write(b, 0, r);
                        os.close();
                        in.close();
                        bus.reply(rid, out.getAbsolutePath());
                    } catch (Exception e) {
                        bus.reply(rid, null);
                    }
                }
            });
            t.setDaemon(true);
            t.start();
        } catch (Exception e) {
            bus.reply(id, null);
        }
    }

    /**
     * Caminho real e legivel por tras de um SAF uri, ou null quando o
     * provider so oferece stream (Drive, cloud, providers sem file path).
     */
    private String realPathFor(Uri uri) {
        try {
            String p = null;
            if ("file".equals(uri.getScheme())) {
                p = uri.getPath();
            } else {
                String docId = DocumentsContract.getDocumentId(uri);
                if (docId != null && docId.length() > 0) {
                    if (docId.startsWith("raw:")) {
                        p = docId.substring(4);
                    } else {
                        int c = docId.indexOf(':');
                        if (c > 0) {
                            String vol = docId.substring(0, c);
                            String rel = docId.substring(c + 1);
                            String base = "primary".equals(vol) ? "/storage/emulated/0" : "/storage/" + vol;
                            p = rel.isEmpty() ? base : base + "/" + rel;
                        } else {
                            p = docId;
                        }
                    }
                }
            }
            if (p != null && p.length() > 0) {
                File f = new File(p);
                if (f.isFile() && f.canRead()) return f.getAbsolutePath();
            }
        } catch (Exception ignore) {}
        return null;
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignore) {}
        return null;
    }

    private boolean probeWritable(String path) {
        try {
            File d = new File(path);
            if (!d.isDirectory() && !d.mkdirs()) return false;
            File probe = File.createTempFile("vitahub_probe", ".tmp", d);
            boolean ok = probe.exists();
            probe.delete();
            return ok;
        } catch (Exception e) {
            return false;
        }
    }

    private void toast(final String msg) {
        main.post(new Runnable() {
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }
}