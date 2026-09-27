package org.vita3k.emulator;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.SurfaceHolder;

import com.vitahub.app.AppLog;

import org.libsdl.app.SDLSurface;

/**
 * Superficie de video do Vita3K no Android.
 *
 * A engine (libVita3K.so) expoe o metodo nativo
 * Java_org_vita3k_emulator_EmuSurface_setSurfaceStatus, que grava um flag
 * global usado pelo renderizador para saber se a superficie Android esta
 * pronta. Sem esse flag a Vulkan nao apresenta nada na tela (tela preta),
 * mesmo com o jogo executando e o audio tocando.
 *
 * A classe oficial (EmuSurface) tambem cria um InputOverlay (botoes de toque
 * na tela). Nao reaproveitamos a oficial porque ela depende de recursos do
 * pacote org.vita3k.emulator (IDs de drawable fixos) que nao existem no
 * pacote deste app.
 *
 * O nome da classe precisa ser exatamente org.vita3k.emulator.EmuSurface
 * porque o vinculo JNI e feito pelo nome da classe + metodo.
 */
public class EmuSurface extends SDLSurface {

    public EmuSurface(Context context) {
        super(context);
    }

    private native void setSurfaceStatus(boolean status);

    /**
     * Isola a chamada nativa porque ela e o unico ponto onde a engine recebe
     * a informacao de que existe uma superficie. Se o simbolo JNI nao
     * resolver, a excecao sobe e mata a Activity — e o sintoma visto de fora
     * e apenas "tela preta", sem nenhuma pista. Logando o resultado da chamada
     * fica claro se o renderizador recebeu o flag ou nao.
     */
    private void mark(boolean ready, String event, int width, int height) {
        String res;
        try {
            setSurfaceStatus(ready);
            res = "ok";
        } catch (Throwable t) {
            res = "FALHOU: " + t;
        }
        AppLog.step("EmuSurface." + event + " " + width + "x" + height
                + " setSurfaceStatus(" + ready + ")=" + res);
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        mark(true, "surfaceCreated", getWidth(), getHeight());
        super.surfaceCreated(holder);
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        mark(true, "surfaceChanged", width, height);
        super.surfaceChanged(holder, format, width, height);
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        mark(false, "surfaceDestroyed", getWidth(), getHeight());
        super.surfaceDestroyed(holder);
    }

    /** Recebe o bitmap capturado, ou a razao da falha em forma de texto. */
    public interface CaptureCallback {
        void onCaptured(Bitmap bitmap, String error);
    }

    /**
     * Copia o conteudo atual da superficie para um Bitmap.
     *
     * <p>O Vita3K nao implementa o modulo SceScreenShot (todas as funcoes
     * retornam UNIMPLEMENTED) e a captura de tela dele vive na camada de
     * desktop, que nao e compilada neste APK. Por isso o print e tirado do
     * lado Android, direto da SurfaceView onde a engine desenha.
     *
     * <p>PixelCopy e a API certa aqui: le o conteudo da Surface ja composto,
     * o que funciona com o renderizador da engine sem interferir no que ela
     * desenha. Travar a Surface com lockCanvas nao serviria, porque isso
     * conflitaria com o SDL Continuing a desenhar por cima.
     *
     * <p>O resultado chega na thread principal, entao quem chama pode tocar
     * na UI direto.
     */
    public void capture(final CaptureCallback cb) {
        try {
            final int w = getWidth(), h = getHeight();
            if (w <= 0 || h <= 0) {
                cb.onCaptured(null, "superficie sem dimensao (" + w + "x" + h + ")");
                return;
            }
            final Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            PixelCopy.request(this, bmp, new PixelCopy.OnPixelCopyFinishedListener() {
                @Override
                public void onPixelCopyFinished(int result) {
                    if (result != PixelCopy.SUCCESS) {
                        cb.onCaptured(null, "PixelCopy retornou " + result);
                    } else {
                        AppLog.step("EmuSurface: print capturado " + bmp.getWidth() + "x" + bmp.getHeight());
                        cb.onCaptured(bmp, null);
                    }
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (Throwable t) {
            AppLog.e("EmuSurface: falha ao capturar tela", t);
            cb.onCaptured(null, "excecao: " + t.getMessage());
        }
    }
}
