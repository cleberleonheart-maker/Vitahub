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
    cfgExtra: spec.cfgExtra || null,
    corruptConfig: !!spec.corruptConfig,
    // Sem isto o cenario de copia interrompida nao existe: o mundo default nao
    // truncaria nunca, e o teste passaria com a arvore inteira quando o que se
    // quer exercitar e a copia morrendo no meio.
    truncateCopy: !!spec.truncateCopy,
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

  // O BOOT NAO PODE INICIALIZAR A ENGINE. Este e o teste do crash de abertura.
  //
  // migrate() recebia a arvore escolhida sem vs0/sys, chamava fwInstall ->
  // NativeLib.init, e o libVita3K.so abortava o processo no Android 16 com
  // "JNI DETECTED ERROR IN APPLICATION: mid == null in call to
  // CallStaticObjectMethod". O usuario so via o app fechar, antes da tela de
  // perfil. A extracao do PUP existe SO dentro da engine, entao a unica saida e
  // perguntar e avisar -- nunca instalar sozinho.
  {
    const w = world({
      // Ha firmware pronto em disco, a arvore escolhida nao tem vs0/sys e o
      // config AFIRMA que ha firmware instalado (instalado numa pasta que o
      // usuario trocou depois). Exato o cenario que fazia o boot sair sozinho
      // para extrair -- e que deixava a tela mentindo.
      files: [STORAGE + '/fw/PSP2UPDAT.PUP'],
      cfgExtra: { fwInstalled: true, fwVersion: '3.74' },
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('boot: a engine NAO e inicializada', w.calls.indexOf('fwInstall'), -1);
    eq('boot: o fwInstall nao aparece em nenhuma forma', w.calls.join(',').indexOf('fwInstall'), -1);
    eq('boot: falta de firmware e reportada', r.fw.missing, true);
    eq('boot: o PUP disponivel e apontado para a UI', r.fw.pupAvailable, true);
    // fwInstalled true com a pasta vazia e o que fazia a tela mentir ("firmware
    // instalado") enquanto o emulador nao ligava. Reconciliado com o disco.
    eq('boot: fwInstalled nao sobrevive sem vs0/sys', w.config.fwInstalled, false);
    eq('boot: a versao mentirosa e limpa junto', w.config.fwVersion, '');
  }

  // Contrario do anterior: com vs0/sys na arvore, nada a fazer e nada a avisar.
  {
    const w = world({ dirs: [NEW + '/vs0/sys'], cfgExtra: { fwInstalled: false } });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('boot com firmware: a engine NAO e inicializada', w.calls.indexOf('fwInstall'), -1);
    eq('boot com firmware: nada falta', r.fw.missing, false);
    eq('boot com firmware: fwInstalled vira true', w.config.fwInstalled, true);
  }

  // ---------------------------------------------------------------------------
  // ADOCAO DE FIRMWARE: trocar de pasta nao pode custar o firmware.
  //
  // O sintoma era o mais dificil de ler que existe, porque nenhuma palavra
  // sobre firmware aparecia em lugar nenhum. O log da engine mostrava a arvore
  // escolhida, o jogo ate comecava ("Game started: Usagi PKGj"), e sete
  // segundos depois vinham "os0:kd/bootimage.skprx: Missing file",
  // "vs0:sys/external/libpgf.suprx: Missing file",
  // "SCE_KERNEL_ERROR_UNKNOWN_LW_MUTEX_ID" e uma cascata de
  // "Invalid read of uint32_t" ate o signal_handler. A tabela de LW mutex fica
  // vazia porque os modulos do kernel nunca carregaram -- e o unico jeito de
  // levar o vs0/os0 para a pasta nova sem passar por NativeLib.init (que aborta
  // o processo no Android 16) e COPIAR o que ja foi extraido em outra arvore.
  {
    // Cenario real: installDir aponta para uma pasta escolhida no cartao, o
    // firmware foi instalado na pasta privada, e a escolhida nao tem nada.
    const CUSTOM = STORAGE + '/Download/ps vita/Vita';
    const w = world({
      installDir: CUSTOM,
      dirs: [CUSTOM + '/ux0/app/USAG00001',
        NEW + '/vs0/sys', NEW + '/os0/kd'],
      files: [NEW + '/vs0/sys/kernel/module', NEW + '/os0/kd/sysmodule.skprx',
        CUSTOM + '/ux0/app/USAG00001/eboot.bin'],
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('adocao: o firmware vem da pasta privada', r.fwAdotado, NEW);
    eq('adocao: vs0 E os0 vao juntos', r.fwPartes.join('+'), 'vs0+os0');
    eq('adocao: a arvore escolhida deixa de faltar firmware', r.fw.missing, false);
    eq('adocao: vs0/sys existe no destino', w.dirs.has(CUSTOM + '/vs0/sys'), true);
    eq('adocao: os0/kd existe no destino', w.dirs.has(CUSTOM + '/os0/kd'), true);
    eq('adocao: o conteudo de vs0 chegou', w.files.has(CUSTOM + '/vs0/sys/kernel/module'), true);
    eq('adocao: o conteudo de os0 chegou',
      w.files.has(CUSTOM + '/os0/kd/sysmodule.skprx'), true);
    // A origem e a unica copia de um firmware que pode ter custado GB de
    // download. NUNCA e apagada -- nem pela adocao, nem pela migracao.
    eq('adocao: a origem NAO e apagada', w.dirs.has(NEW + '/vs0/sys'), true);
    eq('adocao: os arquivos de origem continuam la',
      w.files.has(NEW + '/vs0/sys/kernel/module'), true);
    // O crash de abertura nao pode voltar: adocao e copia de arquivo.
    eq('adocao: a engine NAO e inicializada', w.calls.indexOf('fwInstall'), -1);
  }

  // O destino ja tem firmware: nao ha o que fazer, e sobretudo nao ha o que
  // sobrescrever. Copiar por cima deixaria o emulador dependente de uma operacao
  // de varios GB a cada abertura, sem ganho nenhum.
  {
    const CUSTOM = STORAGE + '/Download/ps vita/Vita';
    const w = world({
      installDir: CUSTOM,
      dirs: [NEW + '/vs0/sys', CUSTOM + '/vs0/sys'],
      files: [NEW + '/vs0/sys/kernel/module', CUSTOM + '/vs0/sys/kernel/module'],
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('adocao inutile: nao adota', r.fwAdotado, undefined);
    eq('adocao inutile: nada falta', r.fw.missing, false);
    eq('adocao inutile: nenhum vs0 copiado', w.calls.filter((c) => c === 'copyTree').length, 0);
  }

  // Sem doador em lugar nenhum: ai sim o caminho e perguntar e avisar. Este e o
  // unico caso em que o firmware realmente falta e a unica resposta honesta e
  // o botao de instalar.
  {
    const CUSTOM = STORAGE + '/Download/ps vita/Vita';
    const w = world({
      installDir: CUSTOM,
      dirs: [CUSTOM + '/ux0/app/USAG00001'],
      files: [STORAGE + '/fw/PSP2UPDAT.PUP'],
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('sem doador: nada foi adotado', r.fwAdotado, undefined);
    eq('sem doador: continua faltando', r.fw.missing, true);
    eq('sem doador: o PUP e apontado para a UI', r.fw.pupAvailable, true);
    eq('sem doador: a engine NAO e inicializada', w.calls.indexOf('fwInstall'), -1);
  }

  // A origem e uma copia INCOMPLETA (morreu no meio). O "ok" do copyTree nao
  // serve: e a existencia de vs0/sys no disco que a engine vai ler, e e ela que
  // precisa ser conferida antes de dizer que deu certo.
  {
    const CUSTOM = STORAGE + '/Download/ps vita/Vita';
    const w = world({
      installDir: CUSTOM,
      dirs: [CUSTOM + '/ux0/app/USAG00001', NEW + '/vs0/sys'],
      files: [NEW + '/vs0/sys/sce_sys/modulo', NEW + '/vs0/sys/kernel/module'],
      truncateCopy: true,
    });
    const api = mount(w);
    const r = await run(api, 'migrate');
    eq('copia incompleta: nada e adotado', r.fwAdotado, undefined);
    eq('copia incompleta: a origem INTACTA', w.files.has(NEW + '/vs0/sys/sce_sys/modulo'), true);
    // O parcial e apagado para que a proxima abertura tente de novo. Sem isto a
    // arvore ficaria com vs0/sys presente e pela metade: o emulador exigiria
    // firmware (e nao avisaria), o boot nao tentaria mais nada, e o jogo
    // voltaria a morrer com o mesmo erro de LW mutex, agora sem nenhum rastro
    // de que algo foi tentado.
    eq('copia incompleta: o vs0 parcial e removido', w.dirs.has(CUSTOM + '/vs0'), false);
    eq('copia incompleta: continua avisando que falta', r.fw.missing, true);
    eq('copia incompleta: a engine NAO e inicializada', w.calls.indexOf('fwInstall'), -1);
  }

  process.exit(report() ? 1 : 0);
})().catch((e) => {
  console.error('erro no teste de migracao:', e && (e.stack || e.message));
  process.exit(1);
});
