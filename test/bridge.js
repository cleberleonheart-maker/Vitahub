/**
 * Ponte e filesystem falsos para testar renderer/js/vitahub_android.js no Node.
 *
 * O codigo que decide o que o usuario ve -- a varredura da biblioteca e a
 * migracao da pasta antiga -- so roda dentro do WebView do Android. Sem isto,
 * descobrir um erro de contagem ou de migracao custava um APK por tentativa, e
 * varios deles pareceram "o jogo nao instala" quando o defeito era um `if`
 * aqui.
 *
 * O mundo e mutavel: move() e mkdirs() mudam os conjuntos, como no aparelho.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'renderer', 'js', 'vitahub_android.js');
const BASE = '/data/user/0/com.vitahub/files/vita';

function newWorld(spec) {
  return {
    dirs: new Set(spec.dirs || []),
    files: new Set(spec.files || []),
    // Pasta que existe mas nao pode ser lida: exists() responde true, listDir()
    // responde null. E o unico caso que e erro de verdade.
    unreadable: new Set(spec.unreadable || []),
    sfo: spec.sfo || '',
    title: spec.title || '',
    category: spec.category || '',
    installDir: spec.installDir || '',
  };
}

/**
 * @param {object} world  mundo de newWorld()
 * @param {object} [opts] slow: metodo que nunca responde, para exercitar o
 *                         timeout e garantir que ele nao vire falso negativo.
 */
function mount(world, opts) {
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
        case 'storageDir': v = BASE.replace(/\/vita$/, ''); break;
        case 'defaultDir': v = BASE; break;
        case 'readConfig': v = world.installDir ? JSON.stringify({ installDir: world.installDir }) : null; break;
        case 'writeConfig': v = true; break;
        case 'mkdirs': v = world.dirs.add(a.path) || true; break;
        case 'move': {
          const src = a.src;
          const dst = a.dst;
          if (!world.dirs.has(src) && !world.files.has(src)) { v = false; break; }
          // move() no aparelho move a pasta inteira; aqui basta o conjunto de
          // destinos, porque os testes olham estrutura, nao conteudo.
          const prefix = src.endsWith('/') ? src : src + '/';
          for (const d of Array.from(world.dirs)) {
            if (d === src) { world.dirs.delete(d); world.dirs.add(dst); continue; }
            if (d.startsWith(prefix)) { world.dirs.delete(d); world.dirs.add(dst + d.slice(src.length)); }
          }
          for (const f of Array.from(world.files)) {
            if (f === src) { world.files.delete(f); world.files.add(dst); continue; }
            if (f.startsWith(prefix)) { world.files.delete(f); world.files.add(dst + f.slice(src.length)); }
          }
          v = true;
          break;
        }
        case 'listDir': {
          const p = a.path;
          if (!world.dirs.has(p)) { v = null; break; }  // ausente ou ilegivel
          const kids = new Set();
          for (const d of world.dirs) {
            if (d.startsWith(p + '/') && !d.slice(p.length + 1).includes('/')) kids.add(d.slice(p.length + 1));
          }
          v = Array.from(kids).sort().map((n) => ({ n, d: true }));
          break;
        }
        case 'exists':
          v = world.dirs.has(a.path) || world.files.has(a.path) || world.unreadable.has(a.path);
          break;
        case 'sfoTitle': v = a.path === world.sfo ? world.title : null; break;
        case 'sfoCategory': v = a.path === world.sfo ? world.category : null; break;
        default: v = null;
      }
      // A ponte embute o valor no objeto do reply, entao ele chega aqui com o
      // tipo que foi enviado. Envolver em JSON.stringify daria string e o
      // Array.isArray do scan cairia sempre no ramo de "nao pode ser lida".
      replies.push({ k: 'r', id: Number(id), v: v === undefined ? null : v });
    },
    poll() { return replies.length ? JSON.stringify(replies.splice(0)) : '[]'; },
  };

  global.window = { AndroidBridge: Bridge, addEventListener() {}, removeEventListener() {} };
  global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
  // t() e interno a locales.js e nao vai para window, entao o stub devolve a
  // chave. As assercoes de texto conferem a chave, de proposito: o que importa
  // aqui e a estrutura, nao a traducao.
  global.t = (k) => k;
  global.setInterval = (fn) => realSetInterval(fn, 1);
  global.setTimeout = setTimeout;
  global.clearTimeout = clearTimeout;
  delete require.cache[SRC];
  new Function(fs.readFileSync(SRC, 'utf8'))();
  return window.vitahub;
}

/** Espera uma chamada da API resolver, com guarda. */
function run(api, name, args, ms) {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error(name + ' nao resolveu')), ms || 20000);
    Promise.resolve(api[name](args)).then((v) => { clearTimeout(guard); resolve(v); },
      (e) => { clearTimeout(guard); reject(e); });
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
function report() {
  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  return fail;
}

module.exports = { BASE, SRC, newWorld, mount, run, eq, report };
