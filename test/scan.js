/**
 * Varredura da biblioteca sem aparelho.
 *
 * renderer/js/vitahub_android.js decide o que aparece na Home e na Biblioteca,
 * mas so roda dentro do WebView do Android -- ate agora nada testava esse
 * codigo, e a unica forma de ver um erro de varredura era instalar um APK,
 * atualizar, e torcer. As falhas que isso escondia nao eram de logica: eram
 * de contagem, e uma contagem errada e indistinguivel de "voce nao instalou
 * nada".
 *
 * Aqui a ponte e falsa e o sistema de arquivos e um conjunto de diretórios e
 * arquivos. O que se testa e a traducao disso para a linha de resumo e para a
 * lista de jogos, que e o unico contrato que o usuario consegue ler.
 */
const { BASE, newWorld, mount, run, eq, report } = require('./bridge');

/** Monta o mundo, roda listApps e devolve o resultado. */
function scan(worldSpec, opts) {
  const api = mount(newWorld(worldSpec), opts);
  return run(api, 'listApps');
}

/** Segmento do resumo da varredura, sem o prefixo. */
function count(report, prefix) {
  const part = String(report).split(' \u00b7 ').find((s) => s.startsWith(prefix));
  return part ? part.slice(prefix.length).trim() : null;
}

(async function () {
  // Um jogo de Vita bem formado: a pasta, o eboot e o param.sfo existem.
  {
    const out = await scan({
      dirs: [BASE + '/ux0/app', BASE + '/ux0/app/PCSF00001', BASE + '/ux0/app/PCSF00001/sce_sys'],
      files: [BASE + '/ux0/app/PCSF00001/eboot.bin', BASE + '/ux0/app/PCSF00001/sce_sys/param.sfo'],
      sfo: BASE + '/ux0/app/PCSF00001/sce_sys/param.sfo',
      title: 'Jogo de Teste',
    });
    eq('jogo valido entra na lista', out.length, 1);
    eq('jogo valido: titulo lido do param.sfo', out[0] && out[0].title, 'Jogo de Teste');
    eq('jogo valido: titleId', out[0] && out[0].titleId, 'PCSF00001');
    eq('jogo valido: contagem sem ressalva', count(out.scanReport, 'ux0/app:'), '1');
  }

  // Pasta que sobrou de uma extracao que nao completou: existe, mas sem eboot.
  // Este e o cenario que produzia "instalou mas nao aparece": a contagem
  // antiga dizia so "0", indistinguivel de biblioteca vazia.
  {
    const out = await scan({ dirs: [BASE + '/ux0/app', BASE + '/ux0/app/PCSF00001'] });
    eq('pasta sem eboot: nao entra na lista', out.length, 0);
    eq('pasta sem eboot: motivo declarado', count(out.scanReport, 'ux0/app:'), '0 de 1 (1 sem eboot.bin)');
  }

  // Leitura que nunca responde: precisa virar "expirou", nunca "nao existe".
  // Sem essa separacao um jogo valido e descartado em silencio -- foi o que
  // aconteceu quando apertei o orcamento da varredura.
  {
    const out = await scan({
      dirs: [BASE + '/ux0/app', BASE + '/ux0/app/PCSF00001', BASE + '/ux0/app/PCSF00001/sce_sys'],
      files: [BASE + '/ux0/app/PCSF00001/eboot.bin', BASE + '/ux0/app/PCSF00001/sce_sys/param.sfo'],
      sfo: BASE + '/ux0/app/PCSF00001/sce_sys/param.sfo',
      title: 'Jogo de Teste',
    }, { slow: 'exists' });
    eq('exists expirado: nao entra na lista', out.length, 0);
    eq('exists expirado: motivo declarado', count(out.scanReport, 'ux0/app:'), '0 de 1 (1 leitura expirou)');
  }

  // pspemu/PSP/GAME ausente e o normal num aparelho so com jogos Vita, e nao
  // pode virar aviso: a biblioteca inteira no ar com um erro de leitura.
  {
    const out = await scan({ dirs: [BASE + '/ux0/app'] });
    eq('pspemu ausente: sem listError', out.listError, '');
    eq('pspemu ausente: declarado no resumo', count(out.scanReport, 'pspemu/PSP/GAME:'), 'library_absent');
  }

  // ux0/app ausente: tambem normal, e tambem nao e erro.
  {
    const out = await scan({ dirs: [] });
    eq('arvore vazia: sem listError', out.listError, '');
    eq('arvore vazia: ux0/app declarado', count(out.scanReport, 'ux0/app:'), 'library_absent');
  }

  // Pasta que existe mas nao pode ser lida: este sim e problema, e precisa dizer
  // qual pasta -- foi o que o app de 2023 chamava de "biblioteca vazia".
  {
    const out = await scan({ dirs: [BASE], unreadable: [BASE + '/ux0/app'] });
    eq('pasta ilegivel: lista vazia', out.length, 0);
    eq('pasta ilegivel: aponta qual', out.listError.indexOf(BASE + '/ux0/app') >= 0, true);
    eq('pasta ilegivel: marcada como erro', out.scanReport.indexOf('library_unreadable') >= 0, true);
  }

  process.exit(report() ? 1 : 0);
})().catch((e) => {
  console.error('erro no teste de varredura:', e && (e.stack || e.message));
  process.exit(1);
});
