import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * Gera o conjunto de icones do launcher a partir de uma unica composicao.
 *
 * <p>Desenhar em espaco normalizado de 108x108 e so entao reduzir para cada
 * densidade evita cinco artefatos separados divergindo entre si. O 108x108 e o
 * canvas do icone adaptativo; a area realmente visivel (a "safe zone") e o
 * circulo de raio 33 no centro, e todo o desenho cabe dentro dele para
 * sobreviver a mascara do launcher (circulo, squircle, gota).
 *
 * <p>Rodar com: java IconGen.java <diretorio-de-saida>
 */
public class IconGen {

    /** Canvas do icone adaptativo. */
    static final double CANVAS = 108.0;
    /** Raio da safe zone: conteudo alem disso pode ser cortado. */
    static final double SAFE = 33.0;

    public static void main(String[] args) throws Exception {
        String root = args.length > 0 ? args[0] : ".";
        String[] buckets = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
        int[] sizes = {48, 72, 96, 144, 192};

        for (int i = 0; i < buckets.length; i++) {
            String dir = root + "/res/mipmap-" + buckets[i];
            new File(dir).mkdirs();
            int px = sizes[i];

            // Camadas do adaptativo: 108dp, artwork e fundo separados.
            write(render(px, true), dir + "/ic_launcher_foreground.png");
            write(render(px, false), dir + "/ic_launcher_background.png");

            // Icones legacy: fundo e arte juntos. Um pouco maior que a safe
            // zone porque o launcher antigo nao recorta por mascara.
            write(renderLegacy(px, false), dir + "/ic_launcher.png");
            write(renderLegacy(px, true), dir + "/ic_launcher_round.png");
        }

        // Marca usada no splash e na tela de boot, em fundo transparente.
        write(renderMark(384), root + "/res/drawable-nodpi/vitahub_mark.png");
        write(renderMark(512), root + "/renderer/brand/vitahub-mark.png");
        System.out.println("icones gerados em " + new File(root).getAbsolutePath());
    }

    static void write(BufferedImage img, String path) throws Exception {
        File f = new File(path);
        File parent = f.getParentFile();
        if (parent != null) parent.mkdirs();
        ImageIO.write(img, "png", f);
    }

    /**
     * Converte uma medida do espaco de 108dp para pixels do bitmap.
     *
     * <p>Graphics2D trabalha em pixels, mas toda a arte e descrita em 108dp.
     * Sem esta conversao, posicoes como o centro (54) viravam 54 px num
     * bitmap de 192 px e o desenho saia no canto, fora da safe zone.
     */
    static double u(int px, double v) {
        return px * v / CANVAS;
    }

    static Color lerp(Color a, Color b, double t) {
        return new Color(
                (int) Math.round(a.getRed() + (b.getRed() - a.getRed()) * t),
                (int) Math.round(a.getGreen() + (b.getGreen() - a.getGreen()) * t),
                (int) Math.round(a.getBlue() + (b.getBlue() - a.getBlue()) * t));
    }

    /** Fundo em gradiente diagonal, escuro como a UI do app. */
    static void paintBackground(Graphics2D g, int px) {
        g.setPaint(new GradientPaint(
                0, 0, new Color(0x0A1526),
                px, px, new Color(0x163A63)));
        g.fill(new Rectangle2D.Double(0, 0, px, px));
    }

    /**
     * Corpo do controle. O contorno desce em dois punhos, que e o que faz
     * o desenho ser lido como gamepad e nao como um retangulo arredondado.
     */
    static Shape gamepadPath(double s, double cx, double cy) {
        double t = cy - 12 * s;   // topo
        double b = cy + 8 * s;    // base dos punhos
        double hw = 23 * s;       // meia-largura
        Path2D.Double p = new Path2D.Double();
        p.moveTo(cx - 12 * s, t);
        p.lineTo(cx + 12 * s, t);
        p.curveTo(cx + 19 * s, t, cx + 23 * s, t + 4 * s, cx + hw, cy - 1 * s);
        p.curveTo(cx + hw + 1 * s, cy + 5 * s, cx + 19 * s, b, cx + 16 * s, b + 1 * s);
        p.curveTo(cx + 11 * s, b + 2 * s, cx + 8 * s, cy + 3 * s, cx + 5 * s, cy + 3 * s);
        p.lineTo(cx - 5 * s, cy + 3 * s);
        p.curveTo(cx - 8 * s, cy + 3 * s, cx - 11 * s, b + 2 * s, cx - 16 * s, b + 1 * s);
        p.curveTo(cx - 19 * s, b, cx - hw - 1 * s, cy + 5 * s, cx - hw, cy - 1 * s);
        p.curveTo(cx - 23 * s, t + 4 * s, cx - 19 * s, t, cx - 12 * s, t);
        p.closePath();
        return p;
    }

    /** Desenha o gamepad com d-pad e dois botoes, centralizado em (cx, cy). */
    static void paintGamepad(Graphics2D g, double s, double cx, double cy) {
        g.setColor(new Color(0xF4F8FC));
        g.fill(gamepadPath(s, cx, cy));

        // D-pad: cruz fina, canto a 40% do que o corpo comporta.
        double dx = cx - 11 * s, dy = cy - 1 * s, a = 6.2 * s, t = 2.2 * s;
        Path2D.Double cross = new Path2D.Double();
        cross.moveTo(dx - a, dy - t);
        cross.lineTo(dx + a, dy - t);
        cross.lineTo(dx + a, dy - a);
        cross.lineTo(dx + t, dy - a);
        cross.lineTo(dx + t, dy + a);
        cross.lineTo(dx + a, dy + a);
        cross.lineTo(dx + a, dy + t);
        cross.lineTo(dx - a, dy + t);
        cross.lineTo(dx - a, dy + a);
        cross.lineTo(dx - t, dy + a);
        cross.lineTo(dx - t, dy - a);
        cross.lineTo(dx - a, dy - a);
        cross.closePath();
        g.setColor(new Color(0x16324F));
        g.fill(cross);

        // Dois botoes: a 48 px um circulo e um segundo quase somem, e quatro
        // viram borrao. Dois e o maximo que continua legivel.
        g.setColor(new Color(0x2E7DD1));
        g.fill(new Ellipse2D.Double(cx + 7.5 * s, cy - 6 * s, 5.6 * s, 5.6 * s));
        g.fill(new Ellipse2D.Double(cx + 13.5 * s, cy + 0.2 * s, 5.6 * s, 5.6 * s));
    }

    /** "VH" abaixo do controle, com espacamento manual entre letras. */
    static void paintVH(Graphics2D g, double s, double cx, double baseline) {
        Font base;
        try {
            base = new Font("DejaVu Sans", Font.BOLD, 10);
        } catch (Exception e) {
            base = new Font(Font.SANS_SERIF, Font.BOLD, 10);
        }
        Font font = base.deriveFont((float) (19 * s));
        g.setFont(font);
        FontMetrics fm = g.getFontMetrics();
        String text = "VH";
        double track = 2.2 * s;
        double w = fm.charWidth('V') + track + fm.charWidth('H');
        double x = cx - w / 2.0;
        for (int i = 0; i < text.length(); i++) {
            g.drawString(String.valueOf(text.charAt(i)), (float) x, (float) baseline);
            x += fm.charWidth(text.charAt(i)) + track;
        }
    }

    static Graphics2D prep(BufferedImage img) {
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        return g;
    }

    /** Camada do adaptativo: foreground so com a arte, ou so o fundo. */
    static BufferedImage render(int px, boolean foreground) {
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = prep(img);
        double s = px / CANVAS;
        if (!foreground) paintBackground(g, px);
        else {
            paintGamepad(g, s, px / 2.0, u(px, 44));
            paintVH(g, s, px / 2.0, u(px, 79));
        }
        g.dispose();
        return img;
    }

    /**
     * Icone legacy. A arte e desenhada 1.12x maior que no adaptativo porque o
     * launcher antigo nao recorta por mascara e o conteudo ficaria pequeno.
     */
    static BufferedImage renderLegacy(int px, boolean round) {
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = prep(img);
        double s = px / CANVAS * 1.12;
        double cx = px / 2.0, cy = u(px, 42);

        Shape clip = round
                ? new Ellipse2D.Double(0, 0, px, px)
                : new RoundRectangle2D.Double(0, 0, px, px, px * 0.18, px * 0.18);
        g.setClip(clip);
        paintBackground(g, px);
        paintGamepad(g, s, cx, cy);
        paintVH(g, s, cx, u(px, 80));
        g.dispose();
        return img;
    }

    /** Marca em fundo transparente, para o splash e a tela de boot. */
    static BufferedImage renderMark(int px) {
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = prep(img);
        // Sem fundo: o splash compoe a marca sobre o proprio fundo.
        double s = px / 108.0;
        double cx = px / 2.0;
        g.setColor(new Color(0xF4F8FC));
        g.fill(gamepadPath(s, cx, u(px, 44)));
        g.setColor(new Color(0x16324F));
        double dx = cx - 11 * s, dy = u(px, 42), a = 6.2 * s, t = 2.2 * s;
        Path2D.Double cross = new Path2D.Double();
        cross.moveTo(dx - a, dy - t); cross.lineTo(dx + a, dy - t);
        cross.lineTo(dx + a, dy - a); cross.lineTo(dx + t, dy - a);
        cross.lineTo(dx + t, dy + a); cross.lineTo(dx + a, dy + a);
        cross.lineTo(dx + a, dy + t); cross.lineTo(dx - a, dy + t);
        cross.lineTo(dx - a, dy + a); cross.lineTo(dx - t, dy + a);
        cross.lineTo(dx - t, dy - a); cross.lineTo(dx - a, dy - a);
        cross.closePath();
        g.fill(cross);
        paintVH(g, s, cx, u(px, 82));
        g.dispose();
        return img;
    }
}
