// Guarda de fiação: nenhum módulo pode ser usado por window.X sem ser exposto.
//
// O bug que este arquivo existe para pegar aconteceu de verdade. Todos os
// módulos do renderer são declarados como `const X = (() => {...})()`. Isso cria
// um binding global LEXICAL: visível como `X` nos outros scripts clássicos, mas
// não cria propriedade em `window`. Resultado: `if (window.Diagnostics)` era
// sempre falso, `bind()` nunca rodou, e o botão Copiar do log não fez nada —
// enquanto a nota de saída aparecia normalmente, porque `init()` é chamado pelo
// nome puro. Cinco versões com o diagnóstico "funcionando" e nenhum botão vivo.
//
// A armadilha é invisível: nada dá erro, o guard apenas cai no else silencioso.
// Um teste de comportamento só pega isso se o teste clicar no botão; este pega
// pelo texto, o que é bem mais barato e cobre os módulos que ainda não existem.

const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'renderer', 'js');

// Globais que não são módulos do renderer. `window.vitahub`, `window.AndroidBridge`
// e `window._cfg` são atribuídos dentro de funções; os demais são do browser.
const NATIVE_OR_BROWSER = new Set([
  'AndroidBridge', 'vitahub', '_cfg', 'location', 'document', 'navigator',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console',
  'fetch', 'alert', 'confirm', 'prompt', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'history',
  'localStorage', 'sessionStorage', 'screen', 'devicePixelRatio', 'innerWidth',
  'innerHeight', 'scrollY', 'performance', 'Image', 'Blob', 'File', 'FileReader',
  'CustomEvent', 'Event', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver',
  'crypto', 'TextDecoder', 'TextEncoder', 'URL', 'AbortController', 'FormData',
  'self', 'top', 'parent', 'open', 'close', 'focus', 'print', 'scrollTo',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'postMessage',
  'getSelection', 'speechSynthesis', 'webkitURL', 'Intl', 'Object', 'Array',
  'String', 'Number', 'JSON', 'Math', 'Date', 'RegExp', 'Promise', 'Map', 'Set',
  'WeakMap', 'URLSearchParams', 'structuredClone', 'queueMicrotask', 'atob', 'btoa',
]);

// Comentários citam `window.X` ao explicar o próprio bug. Varrê-los faria o
// teste acusar a própria explicação, e um teste que acusa a si mesmo é um teste
// que se desliga na primeira edição.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1 ');
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('  FALHOU: ' + msg); }
}

const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));
const sources = new Map();
for (const f of files) sources.set(f, fs.readFileSync(path.join(JS_DIR, f), 'utf8'));

// 1. Toda referência a window.<Modulo> precisa de um window.<Modulo> = em algum lugar.
const referenced = new Map(); // nome -> [arquivos]
const exposed = new Set();

for (const [file, raw] of sources) {
  const src = stripComments(raw);
  const re = /\bwindow\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (NATIVE_OR_BROWSER.has(name)) continue;
    if (!referenced.has(name)) referenced.set(name, []);
    referenced.get(name).push(file);
  }
  //_atribuições_ window.X = ...
  const asg = /\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g;
  while ((m = asg.exec(src)) !== null) exposed.add(m[1]);
}

for (const [name, where] of referenced) {
  ok(exposed.has(name),
    'window.' + name + ' usado em ' + where.join(', ') + ' mas nunca exposto'
    + ' (const ' + name + ' = (() => {})() nao cria window.' + name + ')');
}

// 2. Todo módulo com `const X = (() =>` deve ser exposto em window. Um módulo
//    fechado num const é usável de qualquer script pelo nome, mas fica invisível
//    para quem só enxerga window — que é como o botão de copiar ficou morto.
for (const [file, raw] of sources) {
  const src = stripComments(raw);
  const re = /^const ([A-Za-z_$][\w$]*) = \(\(\) => \{/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    ok(exposed.has(name),
      file + ' declara `const ' + name + '` mas não faz window.' + name
      + ' = ' + name + '; guardas `if (window.' + name + ')` serão sempre falsas');
  }
}

// 3. Regressão específica: o botão que copia o log precisa estar ligado.
//    A nota de saída aparece por init(); o visor, por bind(). Se bind() não
//    rodar, a nota aparece e nenhum botão responde — exatamente o que o
//    usuário relatou ("o log não aparece", "o botão não vai").
const diag = stripComments(sources.get('diagnostics.js') || '');
ok(/window\.Diagnostics\s*=\s*Diagnostics/.test(diag),
  'diagnostics.js não expõe window.Diagnostics, então app.js nunca chama bind()'
  + ' e os botões do log (Copiar, Atualizar, Fechar) ficam sem listener');

const app = stripComments(sources.get('app.js') || '');
ok(/\bif\s*\(window\.Diagnostics\)/.test(app),
  'app.js perdeu o guard de window.Diagnostics');
ok(/window\.Diagnostics\.bind\(\)/.test(app),
  'app.js não chama mais window.Diagnostics.bind()');

// 4. O diagnóstico não pode depender de uma tela que o app talvez nunca abra.
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const homeStart = html.indexOf('<section id="screen-home"');
const homeEnd = html.indexOf('</section>', homeStart);
ok(homeStart > -1, 'index.html: #screen-home não encontrado');
const homeSection = homeStart > -1 ? html.slice(homeStart, homeEnd) : '';
ok(homeSection.indexOf('id="crash-note"') === -1,
  '#crash-note está dentro de #screen-home: o log fica invisível se o app '
  + 'morrer antes de abrir a Home');
ok(homeSection.indexOf('id="logview"') === -1,
  '#logview está dentro de #screen-home: idem');
ok(html.indexOf('id="diag-layer"') > -1, '#diag-layer ausente do index.html');

console.log('  ' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
