'use strict';

const Installer = (() => {
  let bodyEl = null;
  let steps = [];
  let keyPromptResolve = null;
  let keyStepEl = null;
  let keyErrEl = null;
  let lastKeyError = '';

  function ensureBody() {
    if (!bodyEl) bodyEl = document.getElementById('installer-body');
    return bodyEl;
  }

  async function open() {
    showScreen('installer');
    const body = ensureBody();
    body.innerHTML = '';
    steps = [];
    keyStepEl = null;
    keyErrEl = null;
    lastKeyError = '';
    const box = document.createElement('div');
    box.className = 'inst-box';
    box.id = 'inst-box';
    body.appendChild(box);
    return box;
  }

  function stepEl(box, title, detail) {
    const el = document.createElement('div');
    el.className = 'inst-step';
    el.innerHTML = `<span class="n">${steps.length + 1}</span><div class="txt"><div class="t"></div><div class="d"></div></div>`;
    el.querySelector('.t').textContent = title;
    if (detail) el.querySelector('.d').textContent = detail;
    box.appendChild(el);
    steps.push(el);
    el.scrollIntoView({ block: 'nearest' });
    return el;
  }
  function setOk(el, ok) {
    el.classList.toggle('error', !ok);
    el.classList.toggle('ok', ok);
  }

  /**
   * Barra de progresso do passo de instalação.
   *
   * Antes o passo ficava em "Instalando..." do começo ao fim: num jogo de
   * vários GB isso eram minutos sem nenhuma informação, e a única forma de
   * saber se hadn't travado era sair do app. A fase e a porcentagem vêm do
   * evento `install:progress` do host.
   */
  function progressEl(el) {
    let wrap = el.querySelector('.inst-prog');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.className = 'inst-prog';
    wrap.innerHTML =
      '<div class="inst-prog-track"><span class="inst-prog-fill"></span></div>' +
      '<div class="inst-prog-meta"><span class="inst-prog-phase"></span>' +
      '<span class="inst-prog-pct">0%</span></div>';
    el.querySelector('.txt').appendChild(wrap);
    return wrap;
  }

  function onInstallProgress(el) {
    const wrap = progressEl(el);
    const p = el._prog || { done: 0, total: 0, phase: '' };
    if (window.vitahub.onInstallProgress) {
      window.vitahub.onInstallProgress((d) => {
        if (d) {
          p.phase = d.phase || p.phase;
          p.done = d.done || 0;
          p.total = d.total || 0;
        }
        paintProgress(wrap, p, el);
      });
    }
    return wrap;
  }

  function paintProgress(wrap, p, el) {
    const PT = currentLangCode.startsWith('pt');
    const phaseTxt = p.phase === 'verify'
      ? (PT ? 'Validando chave' : 'Validating key')
      : p.phase === 'finalize'
        ? (PT ? 'Preparando o jogo' : 'Preparing game')
        : (PT ? 'Extraindo arquivos' : 'Extracting files');
    // "finalize" não tem total conhecido (é a passagem de escrita do
    // work.bin/head/tail), então fica em 100%: um contador de arquivos
    // ficaria preso em 0% e a barra saltaria de ida e volta, o que parece
    // falha de verdade.
    const pct = p.phase === 'finalize'
      ? 100
      : (p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0);
    wrap.querySelector('.inst-prog-fill').style.width = pct + '%';
    wrap.querySelector('.inst-prog-phase').textContent = phaseTxt;
    wrap.querySelector('.inst-prog-pct').textContent =
      pct + '%' + (p.total > 0 ? ' · ' + fmtBytes(p.done) + ' / ' + fmtBytes(p.total) : '');
    el._prog = p;
  }

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v <= 0) return '';
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1073741824) return (v / 1048576).toFixed(1) + ' MB';
    return (v / 1073741824).toFixed(2) + ' GB';
  }

  async function run(kind) {
    const box = await open();

    if (kind === 'pkg') {
      const s1 = stepEl(box, t('install_pkg_full'), '');
      const pkgFile = await window.vitahub.pickFile({
        title: t('install_pkg'),
        filters: [{ name: 'PKG', extensions: ['pkg'] }],
      });
      if (!pkgFile) return back();
      s1.querySelector('.d').textContent = pkgFile;
      setOk(s1, true);

      // Chave errada NÃO conclui a instalação. O host recusa antes de
      // escrever qualquer arquivo, então aqui o passo de chave se repete:
      // o usuário troca a chave e tenta de novo sem reabrir o instalador
      // (sair do passo devolve null e encerra o laço).
      for (;;) {
        const key = await pickKeyStep(box);
        if (!key) return back();

        const PT = currentLangCode.startsWith('pt');
        const s3 = stepEl(box, t('installer_title'), PT ? 'Instalando via motor de extração VitaHub...' : 'Installing via VitaHub extraction engine...');
        onInstallProgress(s3);
        const res = await window.vitahub.installApp({
          kind: 'pkg', file: pkgFile,
          key: key.key || '', keyKind: key.keyKind || '', zRif: key.zRif || '',
        });
        if (res.ok) {
          if (window.vitahub.onInstallProgress) window.vitahub.onInstallProgress(null);
          const PT2 = currentLangCode.startsWith('pt');
          s3.querySelector('.d').textContent = `${res.title || res.titleId || ''} [${res.titleId || ''}]`.trim();
          s3.querySelector('.t').classList.add('done');
          // Tick verde so com a confirmacao da varredura. "Instalado" sem o
          // titulo ter aparecido na biblioteca era o que deixava o usuario
          // sem nenhuma pista do que fazer; agora o passo mostra o titulo, a
          // pasta onde ele foi gravado e se a biblioteca o enxergou.
          if (res.inLibrary === false) {
            s3.querySelector('.t').classList.remove('done');
            setOk(s3, false);
            s3.querySelector('.d').textContent = (PT2
              ? 'Arquivos extraídos, mas a biblioteca não encontrou o jogo. '
              : 'Files extracted, but the library did not find the game. ')
              + (res.libReport || '');
            toast(PT2 ? 'Instalado, mas não apareceu na biblioteca' : 'Installed, but not in the library');
          } else {
            setOk(s3, true);
            toast('✓');
          }
          Home.refresh();
          showFinish(box);
          return;
        }

        s3.querySelector('.d').textContent = res.error || t('toast_error');
        setOk(s3, false);

        if (!isKeyError(res.error)) {
          // Falha que nao depende da chave (PKG corrompido, espaco, etc).
          // Insistir no laco so esconde o motivo: volta e deixa o usuario
          // reabrir o instalador.
          return back();
        }

        // Recusa por chave: o motivo sobe para o passo da chave, que e o que
        // o usuario precisa trocar. O passo de tentativa e descartado para nao
        // empilhar um bloco novo a cada recusa.
        // O texto fica em `lastKeyError` alem do DOM porque o laco volta
        // para pickKeyStep(), que recria o conteudo do passo — sem isso a
        // recusa aparecia e sumia no mesmo quadro e o usuario nunca lia o
        // motivo, achando que a tela tinha simplesmente travado.
        lastKeyError = res.error;
        if (window.vitahub.onInstallProgress) window.vitahub.onInstallProgress(null);
        keyStepEl.classList.add('key-rejected');
        s3.remove();
        // `steps` alimenta a numeração dos badges; sem remover daqui o
        // contador cresce a cada recusa (3, 4, 5...).
        const si = steps.indexOf(s3);
        if (si >= 0) steps.splice(si, 1);
      }
    } else {
      const s1 = stepEl(box, t(kind === 'zip' ? 'install_zip_full' : 'install_vpk_full'), '');
      const file = await window.vitahub.pickFile({
        title: t(kind === 'zip' ? 'install_zip' : 'install_vpk'),
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      if (!file) return back();
      s1.querySelector('.d').textContent = file;
      setOk(s1, true);

      const s2 = stepEl(box, t('installer_title'), currentLangCode.startsWith('pt') ? 'Instalando...' : 'Installing...');
      const res = await window.vitahub.installApp({ kind, file });
      // Linha de conferencia: tamanho e os 8 primeiros digitos do sha1. O
      // usuario precisa de um valor para comparar com o que o catalogo
      // publica -- sem isso ele nao tem como dizer se o arquivo veio inteiro.
      const stamp = (res && res.sha1)
        ? (PT() ? `${fmtBytes(res.size || 0)} · sha1 ${res.sha1.slice(0, 8)}…` : `${fmtBytes(res.size || 0)} · sha1 ${res.sha1.slice(0, 8)}…`)
        : '';
      if (res.ok) {
        s2.querySelector('.d').textContent = `${res.mode === 'standalone' ? '✓ ' : ''}${res.titleId || (res.mode === 'vita3k' ? 'Vita3K' : '')}${stamp ? ' · ' + stamp : ''}`;
        setOk(s2, true);
        // Mesmo titulo, hash diferente: o segundo download nao e o mesmo
        // arquivo. Nao e erro (pode ser versao nova), mas precisa aparecer.
        if (res.changed) {
          toast(PT() ? 'Atenção: o arquivo é diferente do instalado antes' : 'Warning: file differs from the previous install');
        }
      } else {
        s2.querySelector('.d').textContent = (res.error || t('toast_error')) + (stamp ? ' · ' + stamp : '');
        setOk(s2, false);
      }
    }
    Home.refresh();
  }

  function back() {
    showScreen('home');
  }

  /**
   * Botão "Finalizar" no fim do fluxo de instalação.
   *
   * Sem ele a tela não mudava depois do "✓": o passo ficava verde e o único
   * jeito de sair era o ◀ do canto, o que lia como travamento — o jogo já
   * estava instalado e a biblioteca da home já o mostrava. O botão dá o fim
   * do fluxo no lugar, leva para a home e some junto com a tela.
   */
  function showFinish(box) {
    if (!box || box.querySelector('.inst-finish')) return;
    const PT = currentLangCode.startsWith('pt');
    const wrap = document.createElement('div');
    wrap.className = 'inst-finish';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = PT ? 'Finalizar' : 'Finish';
    btn.addEventListener('click', () => {
      // A key e o arquivo ficam nos campos da tela; a proxima instalacao
      // precisa comecar limpa.
      lastKeyError = '';
      Home.refresh();
      back();
    });
    wrap.appendChild(btn);
    box.appendChild(wrap);
    try { wrap.scrollIntoView({ block: 'nearest' }); } catch (e) { /* noop */ }
  }

  /**
   * Cancela o passo de chave pendente, se houver. Sem isso, sair da tela do
   * instalador (ESC / voltar) deixava o `await pickKeyStep()` para sempre e o
   * fluxo de instalacao ficava travado sem nenhuma mensagem na tela.
   */
  function cancelPending() {
    if (!keyPromptResolve) return false;
    const r = keyPromptResolve;
    keyPromptResolve = null;
    try { r(null); } catch (e) { /* noop */ }
    return true;
  }

  /** Cancela o passo pendente e volta para a home. */
  function cancelFlow() {
    const had = cancelPending();
    back();
    return had;
  }

  async function refreshLibrary() {
    const body = document.getElementById('library-body');
    const games = await window.vitahub.listApps();
    body.innerHTML = '';
    // O resumo da varredura fica sempre visivel aqui, nao so quando ha erro:
    // e a unica linha que diz em qual pasta o app esta procurando e quantos
    // titulos encontrou nela, que e o que fecha o diagnostico de "instalou mas
    // nao aparece" sem precisar de log.
    if (games && games.scanReport) {
      const rep = document.createElement('div');
      rep.className = 'lib-report';
      rep.textContent = games.scanReport;
      body.appendChild(re);
    }
    if (games && games.listError) {
      // Falha de leitura nao e biblioteca vazia: dizer "nenhum jogo instalado"
      // logo depois de instalar um manda o usuario para o canto errado.
      const bad = document.createElement('div');
      bad.className = 'game-card';
      bad.style.cssText = 'grid-column:1/-1;opacity:.7';
      bad.innerHTML = `<p>${escHtml(games.listError)}</p>`;
      body.appendChild(bad);
      return;
    }
    if (!games || !games.length) {
      const empty = document.createElement('div');
      empty.className = 'game-card';
      empty.style.cssText = 'grid-column:1/-1;opacity:.7';
      empty.innerHTML = `<p>${escHtml(t('empty_library'))}</p>`;
      body.appendChild(empty);
      return;
    }
    await Promise.all(games.map(async (g) => {
      const card = document.createElement('div');
      card.className = 'game-card';
      const img = await iconHref(g.icon);
      card.innerHTML = `
        <div class="gc-art"></div>
        <div class="gc-title">${escHtml(g.title || g.titleId)}</div>
        <div class="gc-tid">${escHtml(g.titleId)}</div>`;
      // A arte e injetada via DOM em vez de innerHTML: a CSP do index.html
      // (script-src 'self') bloqueia handlers onerror inline, e o titleId vem
      // do nome da pasta no disco (nameListDir) e nao pode virar markup.
      const art = card.querySelector('.gc-art');
      if (img) {
        const im = document.createElement('img');
        im.className = 'gc-img';
        im.alt = '';
        im.addEventListener('error', () => {
          im.replaceWith(gameArtNode(g.titleId, g.titleId));
        }, { once: true });
        im.src = img;
        art.appendChild(im);
      } else {
        art.appendChild(gameArtNode(g.titleId, g.titleId));
      }
      card.addEventListener('click', () => launch(g));
      body.appendChild(card);
    }));
  }

  /** Equivalente DOM de gameArtSvg(), sem passar por innerHTML. */
  function gameArtNode(tid, name) {
    const span = document.createElement('span');
    span.className = 'gc-svg';
    span.innerHTML = gameArtSvg(tid, name);
    return span;
  }

  async function launch(g) {
    const target = g.titleId || '';
    if (window.vitahub.platform === 'android') {
      const res = await window.vitahub.launchGame(target);
      if (!res.ok) {
        toast(t('toast_error') + ': ' + (res.error || ''));
        return;
      }
      Games.launch(res, {
        onReady: () => window.vitahub.bootTitle(res.titleId),
      });
      return;
    }
    const det = await window.vitahub.detectVita3k();
    if (!det.found) {
      toast('Vita3K: ' + (currentLangCode.startsWith('pt') ? 'configurar em Configurações > Sistema' : 'set path in Settings > System'));
      return;
    }
    toast(`${currentLangCode.startsWith('pt') ? 'Iniciando' : 'Starting'} ${g.titleId}...`);
    const res = await window.vitahub.launchGame(target);
    if (!res.ok) toast(t('toast_error') + ': ' + (res.error || ''));
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    // textContent->innerHTML escapa < > & mas NAO as aspas; sem isso o valor
    // quebrava qualquer atributo onde fosse interpolado.
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // O host distingue "falhou por causa da chave" de "falhou por outro motivo".
  // Sem isso a tela nao diz o que trocar depois de uma recusa.
  function isKeyError(msg) {
    return /chave|key|zrif|work\.bin/i.test(String(msg || ''));
  }

  // Reaproveita o mesmo passo entre tentativas: trocar a chave nao deve
  // empilhar um bloco novo de abas a cada erro.
  function pickKeyStep(box) {
    const PT = currentLangCode.startsWith('pt');
    const s2 = keyStepEl || stepEl(box, t('install_pkg'), PT ? 'Jogo protegido: cole o zRIF ou escolha o work.bin. Se for grátis, use "Jogo grátis (sem chave)".' : 'Protected game: paste the zRIF or choose the work.bin. If it is free, use "Free game (no key)".');
    if (keyStepEl) {
      keyStepEl.classList.remove('key-rejected', 'inst-step-done');
      const tEl = keyStepEl.querySelector('.t');
      if (tEl) tEl.classList.remove('done');
      const i = box.querySelector('.inst-step:last-child');
      if (i && i !== s2) box.appendChild(s2);
    }
    keyStepEl = s2;
    const d = s2.querySelector('.d');
    d.innerHTML = '';
    if (lastKeyError) s2.classList.add('key-rejected');
    const wrap = document.createElement('div');
    wrap.className = 'key-tabbox';
    wrap.innerHTML =
      '<div class="key-tabs">' +
        '<button type="button" class="ktab active" data-tab="zrif">zRIF</button>' +
        '<button type="button" class="ktab" data-tab="workbin">work.bin</button>' +
      '</div>' +
      '<div class="key-pane active" data-pane="zrif">' +
        '<textarea class="kt-zrif" rows="3" placeholder="' + (PT ? 'Cole o código zRIF aqui...' : 'Paste the zRIF here...') + '"></textarea>' +
        '<div class="kt-row">' +
          '<button type="button" class="btn btn-sm kt-load">' + (PT ? 'Carregar arquivo .zrif/.txt/.key' : 'Load .zrif / .txt / .key file') + '</button>' +
          '<span class="kt-file"></span>' +
        '</div>' +
      '</div>' +
      '<div class="key-pane" data-pane="workbin">' +
        '<div class="kt-row">' +
          '<button type="button" class="btn btn-sm kt-pick">' + (PT ? 'Escolher work.bin' : 'Select work.bin') + '</button>' +
          '<span class="kt-file"></span>' +
        '</div>' +
      '</div>' +
      '<div class="kt-row kt-nextrow">' +
        '<button type="button" class="btn kt-nokey">' + (PT ? 'Jogo grátis (sem chave)' : 'Free game (no key)') + '</button>' +
        '<button type="button" class="btn kt-next">' + (PT ? 'Continuar' : 'Continue') + '</button>' +
      '</div>';
    d.appendChild(wrap);

    keyErrEl = document.createElement('div');
    keyErrEl.className = 'kt-err';
    keyErrEl.textContent = lastKeyError;   // sobrevive ao redesenho do passo
    d.insertBefore(keyErrEl, wrap);

    const pane = (name) => wrap.querySelector('.key-pane[data-pane="' + name + '"]');
    wrap.querySelectorAll('.ktab').forEach((bt) => bt.addEventListener('click', () => {
      wrap.querySelectorAll('.ktab').forEach((b) => b.classList.toggle('active', b === bt));
      wrap.querySelectorAll('.key-pane').forEach((p) => p.classList.toggle('active', p === pane(bt.dataset.tab)));
    }));

    const txt = wrap.querySelector('.kt-zrif');
    let zrifFile = '';
    const zrifFileEl = pane('zrif').querySelector('.kt-file');
    const workbinFileEl = pane('workbin').querySelector('.kt-file');
    wrap.querySelector('.kt-load').addEventListener('click', async () => {
      const f = await window.vitahub.pickFile({ title: 'zRIF', filters: [{ name: 'zRIF / key / txt', extensions: ['zrif', 'txt', 'key', 'bin', '*'] }] });
      if (f) {
        zrifFile = f;
        zrifFileEl.textContent = f.split('/').pop().split('\\').pop();
      }
    });
    let workbinFile = '';
    wrap.querySelector('.kt-pick').addEventListener('click', async () => {
      const f = await window.vitahub.pickFile({ title: 'work.bin', filters: [{ name: 'work.bin', extensions: ['bin', '*'] }] });
      if (f) {
        workbinFile = f;
        workbinFileEl.textContent = f.split('/').pop().split('\\').pop();
      }
    });
    setOk(s2, false);

    return new Promise((resolve) => {
      // Uma unica promessa ativa por vez; um cancelamento anterior (ESC) ja
      // resolveu a antiga, entao nao ha como deixar duas penduradas.
      if (keyPromptResolve) cancelPending();
      keyPromptResolve = resolve;
      const settle = (value) => {
        if (keyPromptResolve !== resolve) return;
        keyPromptResolve = null;
        resolve(value);
      };
      // A recusa anterior valia para a chave antiga; ao seguir com outra o
      // aviso sai para nao parecer que a nova tambem foi recusada.
      const done = (out) => {
        lastKeyError = '';
        if (keyErrEl) keyErrEl.textContent = '';
        keyStepEl.classList.remove('key-rejected');
        setOk(s2, true);
        settle(out);
      };
      wrap.querySelector('.kt-nokey').addEventListener('click', () => {
        // PKG publico (keyType 0) nao tem o que validar: o extrator le o
        // conteudo em claro e nao pede licenca. Sem este botao o jogo gratis
        // ficava preso nesta tela — "Continuar" sem chave so mostrava um aviso
        // e nao saia, e como o passo ja nascia marcado como ok (badge verde) o
        // usuario lia "instalado" com nada extraido.
        done({});
      });
      wrap.querySelector('.kt-next').addEventListener('click', () => {
        const active = wrap.querySelector('.ktab.active').dataset.tab;
        let out = null;
        if (active === 'zrif') {
          const z = txt.value.trim();
          if (z) out = { key: '', keyKind: '', zRif: z };
          else if (zrifFile) out = { key: zrifFile, keyKind: 'text', zRif: '' };
        } else if (workbinFile) {
          out = { key: workbinFile, keyKind: 'workbin', zRif: '' };
        }
        if (!out) {
          toast(PT ? 'Informe o zRIF, escolha um arquivo de chave ou use "Jogo grátis (sem chave)".' : 'Enter the zRIF, choose a key file, or use "Free game (no key)".');
          return;
        }
        done(out);
      });
    });
  }

  // ------------------------- aba "Sistema" -------------------------
  //
  // Firmware, pre-update e fontes vivem aqui porque o assistente só oferece
  // esses pacotes uma vez. Quem já passou pela instalação inicial e quer
  // trocar o firmware por uma versão mais nova não tinha caminho nenhum: o
  // menu de arquivos do Android não é lugar para .PUP.

  let sysTab = 'games';
  let fwInfo = null;

  const REGION_LANG = {
    us: 'en-us', gb: 'en-gb', au: 'en-au', ie: 'en-ie',
    jp: 'ja-jp', kr: 'ko-kr', tw: 'zh-hant-tw', hk: 'zh-hant-hk',
    de: 'de-de', fr: 'fr-fr', it: 'it-it', es: 'es-es',
    br: 'pt-br', mx: 'es-mx', eu: 'en-gb',
  };

  function selectLibTab(name) {
    sysTab = name;
    document.querySelectorAll('#lib-tabs .gd-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.ltab === name);
    });
    const games = document.getElementById('library-body');
    const sys = document.getElementById('lib-system');
    if (games) games.classList.toggle('hidden', name !== 'games');
    if (sys) sys.classList.toggle('hidden', name !== 'system');
    if (name === 'system') refreshSystemTab();
  }

  function fmtBytes2(n) {
    const v = Number(n) || 0;
    if (v <= 0) return '';
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1073741824) return (v / 1048576).toFixed(1) + ' MB';
    return (v / 1073741824).toFixed(2) + ' GB';
  }

  function barOf(kind) {
    return {
      wrap: document.getElementById('lib-' + kind + '-bar'),
      fill: document.getElementById('lib-' + kind + '-fill'),
      meta: document.getElementById('lib-' + kind + '-meta'),
    };
  }

  function sysErr(msg) {
    const el = document.getElementById('lib-sys-err');
    if (el) el.textContent = msg || '';
  }

  /** Estado já instalado, lido do config.json (mesmo que o wizard grava). */
  async function refreshSystemTab() {
    sysErr('');
    const cfg = await window.vitahub.getConfig();
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v || '—';
    };
    set('lib-fw-ver', cfg.fwInstalled ? (cfg.fwVersion || '3.74') : t('lib_not_installed'));
    set('lib-pre-ver', cfg.fwPrePath ? (cfg.fwPreVersion || t('lib_installed')) : t('lib_not_installed'));
    set('lib-font-ver', cfg.fwFontPath ? (cfg.fwFontVersion || t('lib_installed')) : t('lib_not_installed'));

    if (fwInfo) return;
    // Só procura uma vez por visita: a consulta vai à Sony e travar a aba
    // com "verificando" a cada troca de aba seria pior que não ter.
    fwInfo = { pending: true };
    const region = (cfg.settings && cfg.settings.region) || 'us';
    const res = await window.vitahub.checkFirmware(region);
    if (res && res.ok && res.info) {
      fwInfo = res.info;
    } else {
      fwInfo = { failed: true };
    }
  }

  /**
   * Escolhe um .PUP. kind=null é o firmware principal; 'pre'/'font' são os
   * pacotes opcionais, que passam por saveOptionalPup() porque a engine só os
   * usa se estiverem em ux0/app/PCSF00001/sys/RELEASE/PUB.
   */
  async function pickAndInstall(kind) {
    const b = barOf(kind || 'fw');
    const btn = document.getElementById('lib-' + (kind || 'fw') + '-btn');
    if (btn) btn.disabled = true;
    sysErr('');
    b.wrap.classList.remove('hidden');
    b.fill.style.width = '8%';
    b.meta.textContent = t('lib_selecting');

    const file = await window.vitahub.pickFile({
      title: t('fw_pick'),
      filters: [{ name: 'Firmware', extensions: ['pup'] }],
    });
    if (!file) {
      b.wrap.classList.add('hidden');
      if (btn) btn.disabled = false;
      return;
    }

    b.fill.style.width = '35%';
    b.meta.textContent = t('fw_installing');
    const res = kind
      ? await window.vitahub.saveOptionalPup({ path: file, kind: kind })
      : await window.vitahub.installFirmware(file);
    if (!res || !res.ok) {
      b.fill.style.width = '0%';
      b.meta.textContent = '';
      sysErr(t('toast_error') + ': ' + ((res && res.error) || ''));
      if (btn) btn.disabled = false;
      return;
    }

    b.fill.style.width = '100%';
    b.meta.textContent = t('fw_done') + (res.version ? ' · ' + res.version : '');
    toast(t('fw_done'));
    // O aviso de "falta firmware" do boot (app.js) dispara uma vez so. Se o
    // vs0/sys sumir de novo -- pasta trocada, apagado pelo usuario -- e preciso
    // avisar de novo, senao o emulador simplesmente nao liga e ninguem sabe.
    window.vitahub.setConfig({ fwWarned: false }).catch(function () {});
    // Zera o cache de consulta para os carimbos de versão voltarem do disco.
    fwInfo = null;
    const cfg = await window.vitahub.getConfig();
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v || '—';
    };
    set('lib-fw-ver', cfg.fwInstalled ? (cfg.fwVersion || '3.74') : t('lib_not_installed'));
    set('lib-pre-ver', cfg.fwPrePath ? (cfg.fwPreVersion || t('lib_installed')) : t('lib_not_installed'));
    set('lib-font-ver', cfg.fwFontPath ? (cfg.fwFontVersion || t('lib_installed')) : t('lib_not_installed'));
    if (btn) btn.disabled = false;
  }

  function openFwSiteFromLib() {
    window.vitahub.getConfig().then((cfg) => {
      const region = (cfg.settings && cfg.settings.region) || 'us';
      const lang = REGION_LANG[region] || 'en-us';
      window.vitahub.openExternal('https://www.playstation.com/' + lang + '/support/hardware/psvita/system-software/');
    });
  }

  function bind() {
    document.getElementById('installer-back').addEventListener('click', () => {
      cancelFlow();
    });
    document.getElementById('library-back').addEventListener('click', () => showScreen('home'));
    document.querySelectorAll('#lib-tabs .gd-tab').forEach((b) => {
      b.addEventListener('click', () => selectLibTab(b.dataset.ltab));
    });
    document.getElementById('lib-fw-btn').addEventListener('click', () => pickAndInstall(null));
    document.getElementById('lib-pre-btn').addEventListener('click', () => pickAndInstall('pre'));
    document.getElementById('lib-font-btn').addEventListener('click', () => pickAndInstall('font'));
    document.getElementById('lib-fw-site').addEventListener('click', openFwSiteFromLib);
    document.querySelectorAll('#pkg-menu .pkg-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('pkg-menu').classList.remove('open');
        run(btn.dataset.kind);
      });
    });
  }

  return { init: bind, run, refreshLibrary, cancelFlow, selectLibTab };
})();

// Ver a nota em diagnostics.js: `const X = (() => ...)()` cria so um binding
// global lexico e NAO uma propriedade em window. Quem procura por window.Installer
// nao encontra. Exposto aqui para que as guardas escritas com window.Installer valham.
window.Installer = Installer;
