import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * Verificacao objetiva das camadas do icone, sem depender de inspecao visual.
 *
 * <p>Responde a tres perguntas que quebram icone na pratica:
 * a arte cabe na safe zone (senao o launcher recorta um pedaco), a camada de
 * fundo e opaca de ponta a ponta (senao aparece um quadrado translucido), e
 * nada encosta na borda do bitmap (senao o recorte do proprio launcher corta).
 */
public class IconCheck {
    public static void main(String[] args) throws Exception {
        for (String bucket : new String[]{"mdpi", "xxxhdpi"}) {
            System.out.println("=== " + bucket + " ===");
            String dir = "res/mipmap-" + bucket + "/";
            check(dir + "ic_launcher_foreground.png", true);
            check(dir + "ic_launcher_background.png", false);
            check(dir + "ic_launcher.png", false);
            check(dir + "ic_launcher_round.png", false);
        }
    }

    static void check(String path, boolean isForeground) throws Exception {
        BufferedImage img = ImageIO.read(new File(path));
        int w = img.getWidth(), h = img.getHeight();
        int minX = w, minY = h, maxX = -1, maxY = -1;
        long opaque = 0, total = (long) w * h;
        // Mede em unidades do canvas de 108dp, que e onde a safe zone vale.
        double canvas = 108.0;
        double safeR = 33.0 * w / canvas, cx = w / 2.0, cy = h / 2.0;
        double worst = 0;
        int outside = 0;

        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int a = (img.getRGB(x, y) >>> 24) & 0xFF;
                if (a < 8) continue;
                opaque++;
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                double d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
                worst = Math.max(worst, d);
                if (isForeground && d > safeR) outside++;
            }
        }
        String name = new File(path).getName();
        System.out.printf("  %-28s %dx%d%n", name, w, h);
        if (opaque == 0) {
            System.out.println("      VAZIO");
            return;
        }
        System.out.printf("      cobertura   %.1f%%  (%.1f px de raio util)%n",
                100.0 * opaque / total, worst);
        System.out.printf("      bbox        x %d..%d   y %d..%d%n", minX, maxX, minY, maxY);
        boolean edge = minX == 0 || minY == 0 || maxX == w - 1 || maxY == h - 1;
        System.out.printf("      encosta na borda ...... %s%n", edge ? "SIM" : "nao");
        if (isForeground) {
            System.out.printf("      fora da safe zone .... %d px (%s)%n", outside,
                    outside == 0 ? "ok" : "RISCO DE CORTE");
        } else {
            System.out.printf("      100%% opaco ........... %s%n",
                    opaque == total ? "sim" : "NAO (" + (total - opaque) + " px transparentes)");
        }
    }
}
