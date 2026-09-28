/**
 * Migracao para a pasta compartilhada: /storage/emulated/0/VitaHub.
 *
 * <p>Por que isto existe: em Android/data nao ha como chegar a biblioteca com
 * nenhuma ferramenta -- o seletor do sistema do Android 11+ bloqueia, e o
 * gerenciador do aparelho tambem. E o desinstalador apaga o diretorio inteiro.
 * Um cartao removivel exigiria permissao por volume, que e mais um lugar de
 * falhar; a pasta compartilhada resolve os dois de uma vez.
 *
 * <p>Por que estes testes sao tantos: a operacao mexe na biblioteca do usuario.
 * O que NUNCA pode acontecer e apagar a origem antes de a copia estar
 * verificada. Cada teste abaixo existe para travar uma ordem especifica de
 * "-- happen, e ai?", e nao apenas o resultado final.
 */
const { newWorld, mount, run, eq, report } = require('./bridge');

const HOME = '/storage/emulated/0';
const SHARED = HOME + '/VitaHub';
const PRIVATE = '/data/user/0/com.vitahub/Android/data/com.vitahub.app/files';
const OLD = PRIVATE + '/vita';
const MARK = SHARED + '/.vitahub-migrando';

const TREES = ['ux0', 'pspemu', 'savedata'];

// Onde cada arvore guarda os jogos. Uma pasta de jogo que nao esta neste
// caminho nao e um jogo: o resumo da biblioteca contaria 0 e o teste passaria
// por um motivo errado.
const GAMES = {
  ux0: 'ux0/app',
  pspemu: 'pspemu/PSP/GAME',
  savedata: 'savedata',
};

/** Monta uma pasta de origem com os jogos pedidos. */
function tree(spec) {
  spec = spec || {};
  // A RAIZ da arvore precisa existir no mundo. Sem ela, delete(OLD) responde
  // falso por nao encontrar a pasta, e toda assercao sobre "a origem foi
  // removida" passa sem que nada tenha sido removido -- exatamente o tipo de
  // teste verde por acidente que a suite precisa nao ter.
  const dirs = [OLD];
  const files = [];
  // Uma biblioteca instalada TEM vs0/sys: e o firmware que o emulador exige
  // para ligar. Sem ele o cenario "sucesso" cairia sempre no guarda-firmware, e
  // o caminho feliz deixaria de ser testado. noFw remove para o caso de quem
  // ainda nao tem firmware.
  if (!spec.noFw) {
    dirs.push(OLD + '/vs0', OLD + '/vs0/sys');
    files.push(OLD + '/vs0/sys/firmware.bin');
  }
  for (const t of TREES) {
    if (spec[t] === false) continue;
    dirs.push(OLD + '/' + t);
    const n = (spec[t] && spec[t].n) || 1;
    const boot = t === 'pspemu' ? 'EBOOT.PBP' : 'eboot.bin';
    for (let i = 0; i < n; i++) {
      const id = 'T' + t + i;
      const g = OLD + '/' + GAMES[t] + '/' + id;
      dirs.push(g);
      files.push(g + '/' + boot);
      // param.sfo dentro de sce_sys: e o arquivo que a verificacao por tamanho
      // percebe faltar quando a copia morre pela metade.
      dirs.push(g + '/sce_sys');
      files.push(g + '/sce_sys/param.sfo');
    }
  }
  const w = newWorld({
    dirs: dirs,
    files: files,
    installDir: OLD,
    sizeOf: spec.sizeOf || 4096,
    free: spec.free === undefined ? 64 * 1024 * 1024 * 1024 : spec.free,
    permission: spec.permission === undefined ? true : spec.permission,
    storageDir: PRIVATE,
    defaultDir: spec.defaultDir === undefined ? SHARED : spec.defaultDir,
  });
  return w;
}

(async function () {
  // Sai cedo, sem tocar em nada, quando a origem nao e a pasta privada: um
  // cartao escolhido pelo usuario e destino, nunca origem.
  {
    const w = newWorld({ storageDir: PRIVATE, defaultDir: SHARED, installDir: '/storage/ABCD/VitaHub/vita' });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('cartao do usuario: nao e movido', r.ok, false);
    eq('cartao do usuario: motivo', r.reason, 'fora');
    eq('cartao do usuario: nada foi criado no destino', w.dirs.has(SHARED), false);
  }

  {
    const w = newWorld({ storageDir: PRIVATE, defaultDir: PRIVATE + '/vita', installDir: OLD });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('destino ainda privado: nao ha para onde ir', r.reason, 'destino-privado');
  }

  // Origem vazia: nada de criar pasta no armazenamento compartilhado por causa
  // de uma arvore que nao tem jogo nenhum.
  {
    const w = newWorld({ storageDir: PRIVATE, defaultDir: SHARED, installDir: OLD });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('origem vazia: nada a fazer', r.reason, 'vazio');
    eq('origem vazia: destino nao foi criado', w.dirs.has(SHARED), false);
  }

  // Sem acesso total aos arquivos: a pasta compartilhada nao e gravavel, e o
  // certo e dizer isso, silenciosamente, em vez de copiar meia biblioteca.
  {
    const w = tree({ permission: false });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('sem permissao: para antes de copiar', r.reason, 'sem-permissao');
    eq('sem permissao: nada copiado', w.dirs.has(SHARED + '/ux0/app/Tux00'), false);
    eq('sem permissao: origem intacta', w.dirs.has(OLD + '/ux0/app/Tux00'), true);
  }

  // Pouco espaco: encher o volume no meio da copia e o jeito mais rapido de
  // deixar a biblioteca partida em dois lugares.
  {
    const w = tree({ free: 1024 });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('espaco insuficiente: para antes de copiar', r.reason, 'espaco');
    eq('espaco insuficiente: origem intacta', w.dirs.has(OLD + '/ux0/app/Tux00'), true);
    eq('espaco insuficiente: destino nao foi criado', w.dirs.has(SHARED), false);
  }

  // Destino ja povoado: a copia antiga do usuario e a biblioteca dele. Mesmo que
  // a config ainda aponte para a pasta privada, sobrescrever seria destruir
  // trabalho dele sem ele ter pedido.
  {
    const w = tree({});
    w.dirs.add(SHARED + '/ux0/app');
    w.dirs.add(SHARED + '/ux0/app/OUTRO');
    w.files.add(SHARED + '/ux0/app/OUTRO/eboot.bin');
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('destino ocupado: nao sobrescreve', r.reason, 'destino-ocupado');
    eq('destino ocupado: o jogo de la continua', w.dirs.has(SHARED + '/ux0/app/OUTRO'), true);
  }

  // Tentativa interrompida: sobrou copia pela metade e o marcador. A origem
  // esta intacta, entao o certo e descartar o parcial e recomecar -- e nao
  // declarar "ocupado" para sempre.
  {
    const w = tree({});
    w.dirs.add(SHARED);
    w.files.add(MARK);
    w.dirs.add(SHARED + '/ux0/app');
    w.dirs.add(SHARED + '/ux0/app/PARCIAL');
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('interrompida: recomeca e completa', r.ok, true);
    eq('interrompida: o parcial saiu', w.dirs.has(SHARED + '/ux0/app/PARCIAL'), false);
    eq('interrompida: o jogo real chegou la', w.dirs.has(SHARED + '/ux0/app/Tux00'), true);
    eq('interrompida: marcador limpo', w.files.has(MARK), false);
  }

  // Caminho feliz.
  {
    const w = tree({ ux0: { n: 2 } });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('sucesso: ok', r.ok, true);
    eq('sucesso: os dois jogos de ux0 chegaram',
      [w.dirs.has(SHARED + '/ux0/app/Tux00'), w.dirs.has(SHARED + '/ux0/app/Tux01')],
      [true, true]);
    eq('sucesso: pspemu tambem', w.dirs.has(SHARED + '/pspemu/PSP/GAME/Tpspemu0'), true);
    eq('sucesso: origem removida so depois de verificada', w.dirs.has(OLD), false);
    eq('sucesso: a config aponta para a pasta compartilhada', w.installDir, SHARED);
    eq('sucesso: marcador limpo', w.files.has(MARK), false);
  }

  // vs0 (firmware) fica fora do PLANEJAMENTO, e por isso fora da copia normal:
  // sao centenas de MB que o host reextrai do PUP. Se entrasse no tamanho
  // planejado, a checagem de espaco reservaria espaco para um arquivo que so e
  // necessario como reserva -- e a migracao pararia "sem espaco" com folga na
  // mao. (A copia de reserva do firmware, quando ela e necessaria, tem cenario
  // proprio logo abaixo.)
  {
    const w = tree({});
    const api = mount(w);
    const plan = await run(api, 'migrateToSharedPlan');
    const planSemFw = await run(mount(tree({ noFw: true })), 'migrateToSharedPlan');
    eq('firmware: o tamanho planejado ignora vs0', plan.bytes, planSemFw.bytes);
    eq('firmware: ha trabalho a fazer', plan.needed, true);
  }

  // So jogo de PSP: nao tem ux0/app, e uma checagem que so olhasse ali
  // deixaria essa biblioteca presa em Android/data para sempre.
  {
    const w = tree({ ux0: false });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('so PSP: migra assim mesmo', r.ok, true);
    eq('so PSP: o jogo chegou', w.dirs.has(SHARED + '/pspemu/PSP/GAME/Tpspemu0'), true);
  }

  // Copia que termina pela metade: a verificacao por tamanho tem de barrar a
  // troca de config e a remocao da origem. E o teste mais importante deste
  // arquivo: e o que separa "migrar" de "perder a biblioteca".
  {
    const w = tree({});
    const api = mount(w);
    w.truncateCopy = true;   // simula o processo morto no meio da copia
    const r = await run(api, 'migrateToShared');
    eq('copia incompleta: nao se declara ok', r.ok, false);
    eq('copia incompleta: motivo', r.reason, 'verificacao');
    eq('copia incompleta: origem INTACTA', w.dirs.has(OLD + '/ux0/app/Tux00'), true);
    eq('copia incompleta: a config nao mudou', w.installDir, OLD);
    eq('copia incompleta: o parcial foi removido', w.dirs.has(SHARED + '/ux0/app/Tux00'), false);
  }

  // O firmware e a ultima armadilha, e a pior. A engine nativa desta sessao ja
  // foi iniciada com o pref-path ANTIGO, entao o vs0/sys pode acabar gravado na
  // arvore que a migracao esta prestes a apagar. Sem checagem, a migracao
  // terminaria "com sucesso" levando o unico firmware do usuario junto.
  {
    const w = tree({});
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('firmware: a migracao conclui', r.ok, true);
    eq('firmware: o destino tem vs0/sys', w.dirs.has(SHARED + '/vs0/sys'), true);
    eq('firmware: a origem pode ser apagada', w.dirs.has(OLD), false);
  }

  // Sem vs0 na origem e sem PUP para reextrair: nao ha firmware no destino. A
  // pasta antiga tem de ficar. E a ultima linha de defesa da biblioteca.
  {
    const w = tree({ noFw: true });
    const api = mount(w);
    const r = await run(api, 'migrateToShared');
    eq('sem firmware: a migracao nao se declara completa', r.fwOk, false);
    eq('sem firmware: a origem NAO foi apagada', w.dirs.has(OLD + '/ux0/app/Tux00'), true);
    eq('sem firmware: os jogos chegaram mesmo assim',
      w.dirs.has(SHARED + '/ux0/app/Tux00'), true);
    eq('sem firmware: motivo declarado', r.reason, 'firmware-pendente');
  }

  process.exit(report() ? 1 : 0);
})().catch((e) => {
  console.error('erro no teste de migracao compartilhada:', e && (e.stack || e.message));
  process.exit(1);
});
