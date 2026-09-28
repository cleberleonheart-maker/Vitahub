/**
 * Migracao da pasta antiga: o defeito que fez "instalei e o jogo nao aparece".
 *
 * migrate() levava os jogos de <storage>/VitaHub para <storage>/vita, mas pulava
 * o destino sempre que a pasta ja existisse -- sem checar se ali havia um jogo.
 * Sobrava o rastro de uma extracao que falhou, o jogo de verdade ficava preso na
 * pasta antiga, e a biblioteca lia a arvore nova e reportava "0 de 1". O
 * resultado da migracao era descartado em app.js, entao nada aparecia na tela.
 * O usuario tinha de descobrir e mover os arquivos na mao.
 *
 * A arvore de PSP tambem nunca foi migrada: um jogo de PSP instalado por uma
 * versao antiga ficava preso na pasta antiga para sempre.
 */
const { BASE, newWorld, mount, run, eq, report } = require('./bridge');

const STORAGE = BASE.replace(/\/vita$/, '');   // getExternalFilesDir(null)
const LEGACY = STORAGE + '/VitaHub';           // installDir das versoes antigas
const NEW = STORAGE + '/vita';                 // installDir atual

function world(spec) {
  spec = spec || {};
  // Une com as pastas de base em vez de substituir: Object.assign trocaria o
  // array inteiro e o teste passaria a listar um diretorio que nao existe no
  // mundo -- falha silenciosa, do mesmo tipo que estes testes existem para
  // pegar.
  const base = [STORAGE, NEW + '/ux0/app', NEW + '/pspemu/PSP/GAME',
    LEGACY, LEGACY + '/ux0/app', LEGACY + '/pspemu/PSP/GAME'];
  const dirs = Array.from(new Set(base.concat(spec.dirs || [])));
  return newWorld({
    dirs,
    files: spec.files || [],
    unreadable: spec.unreadable || [],
    sfo: spec.sfo || '',
    title: spec.title || '',
    installDir: spec.installDir || '',
    corruptConfig: !!spec.corruptConfig,
  });
}

(async function () {
  // Jogo na pasta antiga, destino livre: deve mudar de lugar.
  {
    const w = world({
      dirs: [LEGACY + '/ux0/app/PCSF00001', LEGACY + '/ux0/app/PCSF00001/sce_sys'],
      files: [LEGACY + '/ux0/app/PCSF00001/eboot.bin'],
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('jogo solto: movido', r.moved, 1);
    eq('jogo solto: aparece na arvore nova', w.dirs.has(NEW + '/ux0/app/PCSF00001'), true);
    eq('jogo solto: some da pasta antiga', w.dirs.has(LEGACY + '/ux0/app/PCSF00001'), false);
    eq('jogo solto: eboot veio junto', w.files.has(NEW + '/ux0/app/PCSF00001/eboot.bin'), true);
  }

  // O defeito: destino existe, mas e so o rastro de uma extracao que falhou
  // (pasta sem eboot). O jogo da pasta antiga tem de entrar assim mesmo, e o
  // rastro vai para o lado em vez de ser apagado.
  {
    const w = world({
      dirs: [LEGACY + '/ux0/app/PCSF00001', LEGACY + '/ux0/app/PCSF00001/sce_sys',
        NEW + '/ux0/app/PCSF00001', NEW + '/ux0/app/PCSF00001/sce_sys'],
      files: [LEGACY + '/ux0/app/PCSF00001/eboot.bin'],
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('destino quebrado: jogo entra assim mesmo', w.files.has(NEW + '/ux0/app/PCSF00001/eboot.bin'), true);
    eq('destino quebrado: o rastro foi guardado em .sobrou', w.dirs.has(NEW + '/.sobrou/ux0_app/PCSF00001'), true);
    eq('destino quebrado: rastro fora da arvore de jogos', w.dirs.has(NEW + '/ux0/app/PCSF00001.sobrou'), false);
    eq('destino quebrado: conta como reparo', r.repaired, 1);
    eq('destino quebrado: diz qual titulo', r.repairedFrom, ['PCSF00001']);
  }

  // A copia do usuario na arvore nova e intocavel, mesmo com um jogo antigo
  // de mesmo TITLE_ID esperando na pasta antiga.
  {
    const w = world({
      dirs: [LEGACY + '/ux0/app/PCSF00001', NEW + '/ux0/app/PCSF00001'],
      files: [LEGACY + '/ux0/app/PCSF00001/eboot.bin', NEW + '/ux0/app/PCSF00001/eboot.bin'],
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('destino valido: nao e sobrescrito', r.moved, 0);
    eq('destino valido: conta como pulado', r.skipped, 1);
    eq('destino valido: nada foi guardado de lado', r.repaired, 0);
    eq('destino valido: a copia antiga continua la', w.dirs.has(LEGACY + '/ux0/app/PCSF00001'), true);
  }

  // Arvore de PSP: nunca migrada, entao um jogo de PSP ficava preso para sempre.
  {
    const w = world({
      dirs: [LEGACY + '/pspemu/PSP/GAME/UCJS10041'],
      files: [LEGACY + '/pspemu/PSP/GAME/UCJS10041/EBOOT.PBP'],
    });
    const api = mount(w);
    await run(api, 'migrate');
    eq('psp migrado', w.files.has(NEW + '/pspemu/PSP/GAME/UCJS10041/EBOOT.PBP'), true);
  }

  // Depois de reposto, o jogo passa a contar na varredura. E o contrato que o
  // usuario enxerga: a pasta reparada vira um jogo na lista.
  {
    // Destino com sce_sys mas sem eboot: o rastro de uma extracao interrompida.
    const w = world({
      dirs: [LEGACY + '/ux0/app/PCSF00001', LEGACY + '/ux0/app/PCSF00001/sce_sys',
        NEW + '/ux0/app/PCSF00001', NEW + '/ux0/app/PCSF00001/sce_sys'],
      files: [LEGACY + '/ux0/app/PCSF00001/eboot.bin',
        NEW + '/ux0/app/PCSF00001/sce_sys/param.sfo'],
      sfo: NEW + '/ux0/app/PCSF00001/sce_sys/param.sfo',
      title: 'Jogo Reposto',
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    const out = await run(api, 'listApps');
    eq('reposto: migrado', r.moved, 1);
    eq('reposto: um jogo na lista', out.length, 1);
    // Depois de reposto, a arvore de jogos tem que estar limpa: um jogo e nada
    // mais. Se o rastro ficasse dentro dela, o resumo acusaria para sempre um
    // "jogo sem eboot.bin" que ninguem instalou.
    eq('reposto: contagem limpa', out.scanReport.indexOf('ux0/app: 1 ·') >= 0, true);
  }

  // installDir num cartao SD: a migracao tem que deixar os jogos na arvore que
  // a BIBLIOTECA lista, que e a do cartao. Com o alvo fixo em storage/vita os
  // jogos iam para o armazenamento interno, que listApps() nunca varre: os
  // dados ficavam intactos e a biblioteca inteira sumia da tela.
  {
    const SD = '/storage/1234-5678/VitaHub/vita';
    const w = world({
      dirs: [SD + '/ux0/app', SD + '/pspemu/PSP/GAME', LEGACY + '/ux0/app',
        LEGACY + '/ux0/app/PCSF00001'],
      files: [LEGACY + '/ux0/app/PCSF00001/eboot.bin'],
      installDir: SD,
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('cartao SD: migrado', r.moved, 1);
    eq('cartao SD: jogo foi para a arvore do cartao',
      w.files.has(SD + '/ux0/app/PCSF00001/eboot.bin'), true);
    eq('cartao SD: nada foi parar no armazenamento interno',
      w.files.has(NEW + '/ux0/app/PCSF00001/eboot.bin'), false);
    eq('cartao SD: installDir do usuario foi respeitado', w.installDir, SD);
    // O que a migracao reporta como arvore tem de ser a que a listagem usa, senao
    // o console.log de app.js mente sobre onde os jogos estao.
    eq('cartao SD: arvore reportada e a do cartao', r.engineRoot, SD);
    const out = await run(api, 'listApps');
    eq('cartao SD: o jogo aparece na biblioteca', out.length, 1);
  }

  // config.json corrompido: o default aponta para o armazenamento interno, entao
  // a biblioteca inteira some da tela. loadConfig() nao pode engolir isso em
  // silencio -- tem de deixar rastro no log e preservar o arquivo original.
  {
    const w = world({
      dirs: [NEW + '/ux0/app', NEW + '/ux0/app/PCSF00001'],
      files: [NEW + '/ux0/app/PCSF00001/eboot.bin'],
      corruptConfig: true,
    });
    const api = mount(w);
    const out = await run(api, 'listApps');
    eq('config corrompido: a listagem nao quebra', Array.isArray(out), true);
    // Cai no padrao, e o padrao e onde a listagem deve procurar: o sintoma real
    // de config quebrado e a biblioteca sumir, nao a tela quebrar.
    eq('config corrompido: volta a usar a arvore padrao',
      out.scanReport.indexOf(NEW) === 0, true);
    eq('config corrompido: o jogo segue visivel', out.length, 1);
  }

  process.exit(report() ? 1 : 0);
})().catch((e) => {
  console.error('erro no teste de migracao:', e && (e.stack || e.message));
  process.exit(1);
});
