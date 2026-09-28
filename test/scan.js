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
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'renderer', 'js', 'vitahub_android.js');
const BASE = '/data/user/0/com.vitahub/files/vita';

/**
 * @param {{dirs: string[], files?: string[]}} world
 * @param {object} [opts]  slow: método que nunca responde, para exercitar o
 *                         timeout e garantir que ele nao vire falso negativo.
 */
function mount(world, opts) {
  const dirs = new Set(world.dirs);
  const files = new Set(world.files || []);
  // Pasta que existe mas nao pode ser lida: existe() responde true, listDir()
  // responde null. E o unico caso que e erro de verdade.
  const unreadable = new Set(world.unreadable || []);
  const slow = (opts && opts.slow) || null;

  const replies = [];
  const realSetInterval = setInterval;

  const Bridge = {
    call(method, args, id) {
      const a = JSON.parse(args || '{}');
      if (slow && slow === method) return; // nunca responde: exercita o timeout
      let v;
      switch (method) {
        case 'homeDir': v = '/data/user/0/com.vitahub/files'; break;
        case 'readFile': v = null; break;
        case 'defaultDir': v = BASE; break;
        case 'listDir': {
          const p = a.path;
          if (!dirs.has(p)) { v = null; break; }  // ausente ou ilegivel
          const kids = new Set();
          for (const d of dirs) {
            if (d.startsWith(p + '/') && !d.slice(p.length + 1).includes('/')) kids.add(d.slice(p.length + 1));
          }
          v = Array.from(kids).sort().map((n) => ({ n, d: true }));
          break;
        }
        case 'exists':
          v = dirs.has(a.path) || files.has(a.path) || unreadable.has(a.path);
          break;
        case 'sfoTitle': v = a.path === world.sfo ? (world.title || '') : null; break;
        case 'sfoCategory': v = a.path === world.sfo ? (world.category || '') : null; break;
        default: v = null;
      }
      // A ponte embute o valor no objeto do reply, entao ele chega aqui como o
      // tipo que foi enviado. Envolver em JSON.stringify daria string e o
      // Array.isArray do scan cairia sempre para o ramo de "nao pode ser lida".
      replies.push({ k: 'r', id: Number(id), v: v === undefined ? null : v });
    },
    poll() { return replies.length ? JSON.stringify(replies.splice(0)) : '[]'; },
  };

  global.window = { AndroidBridge: Bridge, addEventListener() {}, removeEventListener() {} };
  global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
  // t() e interno a locales.js e nao vai para window, entao o stub devolve a
  // chave. As assercoes de texto conferem a chave, de proposito: o que importa
  // aqui e a estrutura do relatorio, nao a traducao.
  global.t = (k) => k;
  global.setInterval = (fn) => realSetInterval(fn, 1);
  global.setTimeout = setTimeout;
  global.clearTimeout = clearTimeout;
  delete require.cache[SRC];
  new Function(fs.readFileSync(SRC, 'utf8'))();
  return window.vitahub;
}

function scan(world, opts) {
  const api = mount(world, opts);
  return new Promise((resolve, reject) => {
    // A varredura gasta um timeout por arvore quando uma leitura nao responde.
    const guard = setTimeout(() => reject(new Error('listApps nao resolveu')), 20000);
    api.listApps().then((out) => { clearTimeout(guard); resolve(out); }, (e) => { clearTimeout(guard); reject(e); });
  });
}

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++;
  console.log('  FALHA ' + name + '\n         esperado: ' + b + '\n         obtido:   ' + a);
}

function count(report, prefix) {
  const part = String(report).split(' · ').find((s) => s.startsWith(prefix));
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

  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('erro no teste de varredura:', e && (e.stack || e.message));
  process.exit(1);
});
