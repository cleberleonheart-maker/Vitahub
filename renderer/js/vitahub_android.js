(function () {
  'use strict';

  if (window.vitahub && window.vitahub.platform !== undefined) return;

  const B = window.AndroidBridge;
  if (!B) {
    console.error('AndroidBridge n\u00e3o dispon\u00edvel');
    return;
  }

  const pending = {};
  const events = {};
  let seq = 0;
  // Quantas chamadas estouraram o timeout. Sem isso, uma leitura expirada
  // devolvia null igual a uma leitura que respondeu "nao existe", e a varredura
  // descartava um jogo valido como se a pasta estivesse vazia.
  const stats = { timeouts: 0 };

  function call(method, args, timeoutMs) {
    return new Promise(function (resolve) {
      const id = String(++seq);
      let done = false;
      let timer = null;
      // Sem timeout, uma resposta perdida pelo poll (o Android estrangula
      // setInterval em WebView em segundo plano) deixava a promessa pendurada
      // para sempre: a tela que dependia dela nao desenhava e nao mostrava erro
      // nenhum. So as leituras curtas recebem limite — instalar um jogo de
      // varios GB legitimately leva minutos.
      const finish = function (v) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        delete pending[id];
        resolve(v);
      };
      pending[id] = finish;
      if (timeoutMs) {
        timer = setTimeout(function () {
          console.warn('VitaHub: sem resposta do host para ' + method + ' em ' + timeoutMs + 'ms');
          stats.timeouts++;
          finish(null);
        }, timeoutMs);
      }
      try {
        B.call(method, JSON.stringify(args || {}), id);
      } catch (e) {
        finish(null);
      }
    });
  }

  function toastMsg(msg) {
    call('toast', { msg: String(msg) });
  }

  let fwChain = Promise.resolve();
  function fwQueue(fn) {
    const run = fwChain.then(fn);
    fwChain = run.then(function () {}, function () {});
    return run;
  }

  function nativeFwInstall(path) {
    return fwQueue(function () {
      return call('fwInstall', { path: path }).then(function (r) {
        if (r && r.ok) return { ok: true, version: String(r.version || '') };
        return { ok: false, error: (r && r.error) || 'Extra\u00e7\u00e3o do firmware falhou' };
      });
    });
  }

  window.__np_poll = function () {
    let items;
    try {
      items = JSON.parse(B.poll());
    } catch (e) {
      return;
    }
    if (!Array.isArray(items)) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.k === 'r') {
        const cb = pending[it.id];
        if (cb) {
          delete pending[it.id];
          cb(it.v);
        } else {
          // Resposta orfa: sem este aviso uma divergencia de id vira promessa
          // pendurada para sempre, sem nenhum sintoma visivel.
          console.warn('VitaHub: resposta sem pedido correspondente, id=' + it.id);
        }
      } else if (it.k === 'e') {
        const f = events[it.n];
        if (f) {
          try { f(it.v); } catch (e) { /* ignore */ }
        }
      }
    }
  };
  setInterval(window.__np_poll, 90);

  const SETTINGS = {
    resolution: 'native',
    renderer: 'Vulkan',
    customDriverName: '',
    gpuIdx: 0,
    bufferRendering: true,
    textureFiltering: false,
    vSync: true,
    skipIntro: false,
    forceGLES: false,
    screenScale: 'pcm',
    background: 'default',
    readMemCards: true,
    importMemCards: true,
    delayVideo: false,
    colorspace: 'srgb',
    showGpuStats: false,
    dumpOnCrash: true,
    resolutionMultiplier: 1,
    anisotropicFiltering: 1,
    highAccuracy: false,
    disableSurfaceSync: true,
    screenFilter: 'Nearest',
    memoryMapping: 'Double buffer',
    asyncPipelineCompilation: true,
    textureCache: true,
    hashlessTextureCache: true,
    importTextures: false,
    exportTextures: false,
    exportAsPng: true,
    shaderCache: true,
    spirvShader: false,
    fpsHack: false,
    cpuPoolSize: 10,
    audioBackend: 'SDL',
    audioVolume: 100,
    ngsEnable: true,
    themeMusic: false,
    themeMusicVolume: 50,
    frontCamType: 2,
    frontCamColor: '#000000',
    frontCamImage: '',
    frontCamId: '',
    backCamType: 2,
    backCamColor: '#000000',
    backCamImage: '',
    backCamId: '',
    sysButton: 1,
    pstvMode: false,
    showMode: false,
    demoMode: false,
    sysLang: 1,
    userLang: '',
    currentImeLang: 4,
    imeLangs: [4],
    sysDateFormat: 0,
    sysTimeFormat: 0,
    analogMultiplier: 100,
    disableMotion: false,
    ledColor: '',
    keyboard: {},
    controllerBinds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    controllerAxisBinds: [0, 1, 2, 3, 4, 5, 6],
    stylesheet: 'classic',
    backgroundAlpha: 30,
    appsListGrid: false,
    logBufferSize: 0,
    logFontFamily: '',
    showWelcome: true,
    warnMissingFirmware: true,
    confirmExit: false,
    bootAppsFullScreen: false,
    showLiveAreaScreen: true,
    showCompileShaders: true,
    turboMode: false,
    checkForUpdatesMode: 'prompt',
    discordRichPresence: false,
    performanceOverlay: false,
    performanceOverlayDetail: 0,
    performanceOverlayPosition: 0,
    fullscreenHdResPixelPerfect: true,
    stretchDisplayArea: true,
    screenshotFormat: 0,
    fileLoadingDelay: 0,
    delayStart: 0,
    delayBackground: 0,
    logLevel: 2,
    logExports: false,
    logImports: false,
    logActiveShaders: false,
    logUniforms: false,
    logCompatWarn: false,
    archiveLog: false,
    gdbstub: false,
    waitForDebugger: false,
    tracyPrimitiveImpl: false,
    tracyModules: [],
    httpEnable: true,
    psnSignedIn: false,
    userAutoConnect: true,
    httpTimeoutAttempts: 3,
    httpTimeoutSleepMs: 500,
    httpReadEndAttempts: 5,
    httpReadEndSleepMs: 500,
    adhocAddr: '',
    validationLayer: false,
    logColorSurface: false,
    dumpElfs: false,
    watchMemory: false,
    watchImportCalls: false,
  };


  let cfg = null;

  // ---------------------------------------------------------------
  // Update checker (desativado nesta versao local)
  // ---------------------------------------------------------------
  // Nenhum repositorio remoto e consultado. Para reativar, defina no
  // update.conf o OWNER/REPO e a URL base da API de releases e faca o
  // build.sh substituir os placeholders abaixo.
  const UPDATE_OWNER = '__VitaHub_UPDATE_OWNER__';
  const UPDATE_REPO = 'VitaHub';

  // Titulos que moram em ux0/app mas nao sao jogaveis. O AUTOPLUG0 aparece la
  // porque a instalacao do firmware extrai o proprio atualizador; rodar ele
  // dentro do emulador trava a engine. A lista cobre so o que ja foi visto
  // neste aparelho — a checagem por CATEGORY no param.sfo e o filtro geral.
  const SYSTEM_TITLES = ['AUTOPLUG0'];
  const UPDATE_API_BASE = '__VitaHub_UPDATE_API_BASE__';
  const RELEASE_API = UPDATE_API_BASE + UPDATE_OWNER + '/' + UPDATE_REPO + '/releases/latest';
  const RELEASE_PAGE = UPDATE_OWNER + '/' + UPDATE_REPO + '/releases/latest';

  function placeholderSet(v) {
    return !!v && v.charAt(0) !== '_' && v.indexOf('__') !== 0;
  }

  function updateConfigured() {
    return placeholderSet(UPDATE_OWNER) && placeholderSet(UPDATE_API_BASE);
  }

  function parseVersion(v) {
    const s = String(v == null ? '' : v).trim().replace(/^v/i, '');
    const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+.](.*))?$/);
    if (!m) return null;
    return {
      major: parseInt(m[1], 10) || 0,
      minor: parseInt(m[2] || '0', 10),
      patch: parseInt(m[3] || '0', 10),
      pre: m[4] ? String(m[4]) : '',
    };
  }

  function isNewer(latest, current) {
    const a = parseVersion(latest), b = parseVersion(current);
    if (!a) return false;
    if (!b) return true;
    for (const k of ['major', 'minor', 'patch']) {
      if (a[k] > b[k]) return true;
      if (a[k] < b[k]) return false;
    }
    // 1.2.0-beta1 < 1.2.0: a release estavel sempre ganha da pre-release.
    if (a.pre && !b.pre) return false;
    if (!a.pre && b.pre) return true;
    return false;
  }

  const Update = {
    repoPage: function () {
      return updateConfigured() ? RELEASE_PAGE : '';
    },

    check: function () {
      if (!updateConfigured()) {
        return Promise.resolve({ ok: false, configured: false, error: 'repositorio de updates nao configurado neste build' });
      }
      return Promise.all([call('version'), call('updateFetch', { url: RELEASE_API, maxBytes: 512 * 1024 })])
        .then(function (r) {
          const ver = r[0] || {};
          const http = r[1] || {};
          const current = String(ver.version || '0');
          if (!http.ok) {
            return { ok: false, configured: true, current: current, error: http.error || ('HTTP ' + (http.status || '?')) };
          }
          let rel;
          try {
            rel = JSON.parse(String(http.body || ''));
          } catch (e) {
            return { ok: false, configured: true, current: current, error: 'resposta da API invalida' };
          }
          if (!rel || rel.draft || !rel.tag_name) {
            return { ok: false, configured: true, current: current, error: 'nenhuma release publicada' };
          }
          const assets = Array.isArray(rel.assets) ? rel.assets : [];
          let apk = null;
          for (const a of assets) {
            if (/\.apk$/i.test(String(a.name || ''))) { apk = a; break; }
          }
          const latest = String(rel.tag_name).replace(/^v/i, '');
          return {
            ok: true,
            configured: true,
            // A comparacao e feita por versionCode, nao por versionName. As
            // tags desta serie sao vNN do mesmo versionCode que o Android
            // instala, entao sao a mesma escala. Comparar com versionName
            // (fixo em 1.0.2) fazia isNewer('v24','1.0.2') ser sempre true:
            // o app oferecia update para sempre, inclusive para a versao ja
            // instalada, e o banner mostrava "1.0.2 -> 24".
            current: String(ver.versionCode || 0),
            currentName: current,
            currentCode: Number(ver.versionCode || 0),
            latest: latest,
            tag: String(rel.tag_name),
            hasUpdate: isNewer(latest, String(ver.versionCode || 0)),
            name: String(rel.name || rel.tag_name),
            notes: String(rel.body || ''),
            url: String(rel.html_url || RELEASE_PAGE),
            publishedAt: String(rel.published_at || ''),
            apkUrl: apk ? String(apk.browser_download_url || '') : '',
            apkName: apk ? String(apk.name || 'VitaHub.apk') : '',
            apkSize: apk ? Number(apk.size || 0) : 0,
          };
        })
        .catch(function (e) {
          return { ok: false, configured: true, error: String((e && e.message) || e) };
        });
    },

    download: function (url, name) {
      return call('updateDownload', { url: String(url || ''), name: String(name || 'VitaHub.apk') });
    },

    install: function (path, name) {
      return call('updateInstall', { path: String(path || ''), name: String(name || '') });
    },

    canInstall: function () {
      return call('updateInstallPerm', {}).then(function (r) {
        return !!(r && r.allowed);
      });
    },

    askInstallPerm: function () {
      return call('updateInstallPermAsk', {});
    },

    onProgress: function (cb) { if (cb) events['update:progress'] = cb; },
  };

  async function defaultConfig() {
    const home = (await call('homeDir')) || '';
    const dfltDir = await call('defaultDir');
    return {
      user: 'VitaHub',
      codename: 'com.vitahub.app',
      lang: 'pt-BR',
      fwInstalled: false,
      fwVersion: null,
      installDir: dfltDir || home + '/VitaHub',
      overwrite: false,
      wizardDone: false,
      avatar: 0,
      settings: Object.assign({}, SETTINGS),
    };
  }

  async function loadConfig() {
    if (cfg) return cfg;
    const home = (await call('homeDir')) || '';
    const raw = await call('readFile', { path: home + '/config.json' });
    const d = await defaultConfig();
    try {
      cfg = raw ? Object.assign({}, d, JSON.parse(raw)) : d;
    } catch (e) {
      // Config corrompida nao pode ser um silencio: o default aponta para o
      // armazenamento interno, entao a biblioteca inteira -- que pode estar num
      // cartao SD escolhido pelo usuario -- some da tela sem nenhuma mensagem,
      // e o unico sinal e o sintoma "meus jogos sumiram". O arquivo original e
      // preservado em config.json.ruim para o diagnostico.
      cfg = d;
      call('mark', { tag: 'config.json ilexivel: ' + (e && e.message ? e.message : e) });
      (async function () {
        const home = await call('homeDir');
        await call('writeFile', { path: home + '/config.json.ruim', content: String(raw || '') });
      })().catch(function () {});
    }
    cfg.settings = Object.assign({}, SETTINGS, cfg.settings && typeof cfg.settings === 'object' ? cfg.settings : {});
    return cfg;
  }

  async function saveConfig() {
    const home = (await call('homeDir')) || '';
    // Gravacao atomica (tmp + rename) e nao writeFile: config.json guarda o
    // installDir e os favoritos, e um FileOutputStream truncante deixaria o
    // arquivo pela metade se o processo morresse no meio -- o aparelho mata o
    // app com frequencia o bastante para isso nao ser hipotese.
    return call('writeFileAtomic', { path: home + '/config.json', content: JSON.stringify(cfg, null, 2) });
  }

  /**
   * Segundos jogados por titulo, gravados pela EngineActivity em
   * playtime.json. Arquivo separado de config.json de proposito: cada um tem
   * um so dono (a engine escreve o tempo, a tela de Configuracoes escreve o
   * config), senao um gravacao sobrescreveria a outra.
   */
  async function playStats() {
    try {
      const home = (await call('homeDir')) || '';
      const raw = await call('readFile', { path: home + '/playtime.json' });
      if (!raw) return {};
      const o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : {};
    } catch (e) {
      return {};
    }
  }

  /** Junta o que a tela precisa por titulo: ultimo uso, tempo e favorito. */
  async function libraryMeta() {
    const [c, stats] = await Promise.all([loadConfig(), playStats()]);
    const favs = (c && c.favs && typeof c.favs === 'object') ? c.favs : {};
    const played = (c && c.play && typeof c.play === 'object') ? c.play : {};
    return function meta(titleId) {
      const p = played[titleId] || {};
      const s = stats[titleId] || {};
      return {
        last: Number(p.last || 0),
        sec: Math.max(0, Number(s.sec || 0)),
        fav: favs[titleId] === true,
      };
    };
  }

  /** Registra que o titulo foi aberto agora. Nao mexe no tempo: quem soma e a engine. */
  async function markPlayed(titleId) {
    if (!titleId) return null;
    await loadConfig();
    if (!cfg.play || typeof cfg.play !== 'object') cfg.play = {};
    cfg.play[titleId] = { last: Date.now() };
    await saveConfig();
    return true;
  }

  async function toggleFav(titleId) {
    if (!titleId) return false;
    await loadConfig();
    if (!cfg.favs || typeof cfg.favs !== 'object') cfg.favs = {};
    const on = !cfg.favs[titleId];
    if (on) cfg.favs[titleId] = true;
    else delete cfg.favs[titleId];
    await saveConfig();
    return on;
  }

  function detectTitleId(entries) {
    if (!entries) return null;
    for (const e of entries) {
      const n = String(e).replace(/\\/g, '/');
      const m1 = n.split('ux0:/app/')[1];
      if (m1) {
        const t = m1.split('/')[0];
        if (/^[A-Z0-9]{9}$/.test(t)) return t;
      }
      if (n.indexOf('app/') === 0) {
        const t = n.slice(4, 13);
        if (/^[A-Z0-9]{9}$/.test(t)) return t;
      }
      if (/^[A-Z]{4}[0-9]{5}/.test(n)) return n.slice(0, 9);
    }
    return null;
  }

  window.vitahub = {
    platform: 'android',

    /** Como a sessao anterior terminou (crash nativo, ANR, normal). */
    lastExit: function () { return call('lastExit', {}); },

    /**
     * Le a cauda de um log interno (app ou engine) ja com repeticoes
     * colapsadas em "linha xN". Sem o colapso o log da engine fica
     * ilegivel quando um erro se repete milhares de vezes.
     */
    readLog: function (which, maxBytes) {
      return call('readLog', { which: which || 'app', maxBytes: maxBytes || 400000 });
    },

    getConfig: function () { return loadConfig(); },

    setConfig: function (partial) {
      return loadConfig().then(function () {
        if (partial && typeof partial === 'object') {
          Object.assign(cfg, partial);
          if (partial.settings) cfg.settings = Object.assign({}, SETTINGS, cfg.settings, partial.settings);
        }
        return saveConfig().then(function () { return loadConfig(); });
      });
    },

    resetConfig: function () {
      cfg = null;
      return call('homeDir').then(function (home) {
        return call('deleteFile', { path: home + '/config.json' });
      });
    },

    pickDirectory: function () {
      // Normaliza aqui: um erro do host chega como {ok:false,error} e os
      // chamadores so testam truthiness, o que salvava o objeto como caminho.
      return call('pickDir').then(function (r) {
        return typeof r === 'string' && r ? r : null;
      });
    },

    pickFile: function () {
      return call('pickFile', {}).then(function (r) {
        return typeof r === 'string' && r ? r : null;
      });
    },

    version: function () { return call('version'); },
    update: Update,

    /**
     * Volumes montados: armazenamento interno, cartao SD e pendrive USB. Um
     * pendrive nao precisa de permissao de USB: quem monta e o vold, e ele
     * aparece aqui como /storage/<UUID>. O que muda conforme a versao do
     * Android e o acesso a esse caminho (ver storageAccess).
     */
    volumes: function () { return call('volumes'); },

    storageAccess: function () { return call('storageAccess'); },

    requestStorageAccess: function () { return call('requestStorageAccess'); },

    /**
     * Informa a engine que a arvore vita/ passa a morar em outro lugar. Sem
     * isso o pref-path so seria corrigido no boot seguinte do emulador, e o
     * firmware instalado antes ficaria na pasta antiga.
     */
    setPrefPath: function (path) { return call('setPrefPath', { path: path || '' }); },

    /**
     * Garante vs0/sys na arvore escolhida. O firmware e extraido para o
     * pref-path que estiver ativo na sessao nativa, entao trocar de volume
     * deixa a arvore nova sem vs0/sys e nenhum jogo abre ate reinstalar.
     */
    ensureFirmware: function (dir) {
      const self = this;
      return call('exists', { path: dir + '/vs0/sys' })
        .then(function (has) {
          if (has) return { ok: true, present: true };
          return call('storageDir').then(function (storage) {
            const pup = (storage || '') + '/fw/PSP2UPDAT.PUP';
            return call('exists', { path: pup }).then(function (hasPup) {
              if (!hasPup) return { ok: false, missing: true };
              return self.fwInstall(pup).then(function (r) {
                if (r && r.ok) return { ok: true, present: false, installed: true, version: r.version };
                return { ok: false, error: (r && r.error) || 'falha ao instalar o firmware' };
              });
            });
          });
        });
    },

    launchGame: function (target) {
      const self = this;
      return self.listApps().then(function (apps) {
        const t = String(target || '');
        const g = apps.find(function (a) { return a.titleId === t; })
          || (t ? apps.find(function (a) { return t.indexOf(a.titleId) === 0; }) : null)
          || null;
if (!g) return { ok: false, error: t ? 'Jogo não encontrado: ' + t : 'Sem jogo instalado' };
        return self.installDir().then(async function (base) {
          const dir = g.dir || (base + '/ux0/app/' + g.titleId);
          const boot = g.kind === 'psp' ? 'EBOOT.PBP' : 'eboot.bin';
          const ex = await call('exists', { path: dir + '/' + boot });
          if (!ex) return { ok: false, error: boot + ' n\u00e3o encontrado' };
          if (g.kind !== 'psp') {
            const prob = await call('probeEboot', { path: dir });
            if (prob && prob.kind === 'enc') {
              let hasPfs = false, kt = null, it = null, pf = null, pfErr = '';
              try {
                const sf = await call('listDir', { path: dir + '/sce_pfs' });
                hasPfs = Array.isArray(sf) && sf.length > 0;
              } catch (e) {}
              try {
                const db64 = await call('base64File', { path: dir + '/sce_sys/package/_install.json' });
                if (db64) {
                  const o = JSON.parse(atob(String(db64)));
                  kt = o.keyType; it = o.itemCount; pf = o.pfsFiles; pfErr = o.pfsError || '';
                }
              } catch (e) {}
              let diag = ' (' + (prob.size || 0) + 'B' +
                (kt != null ? ', keyType ' + kt + ', ' + it + ' item(s)' : '') +
                (hasPfs ? ', PFS presente no disco' : ', sem PFS') +
                (pf != null ? ', PFS decriptou ' + pf + ' arquivo(s)' : '') +
                (pfErr ? ', PFS: ' + pfErr : '') + ')';
              const hint = hasPfs
                ? 'aplica\u00e7\u00e3o Sony selada (PFS): reinstale o mesmo PKG com a licen\u00e7a certa (work.bin/zRIF da sua conta PSN) para o eboot virar um SELF execut\u00e1vel.'
                : 'o eboot est\u00e1 selado/cifrado nesse direto\u00f3rio: instale o jogo pelo instalador de PKG com sua licen\u00e7a (gera o eboot SELF, que a engine descodifica em runtime) ou use um VPK/dump do seu pr\u00f3prio jogo.';
              return { ok: false, error: 'eboot.bin ainda criptografado' + diag + '. ' + hint };
            }
            if (prob && prob.kind === 'missing') return { ok: false, error: 'eboot.bin ausente' };
          }
          return {
            ok: true,
            mode: 'embedded',
            titleId: g.titleId,
            title: g.title || '',
            icon: g.icon || '',
            kind: g.kind || 'vita',
          };
        });
      });
    },

    bootTitle: function (titleId) {
      // Marca o ultimo uso ANTES de abrir, para o "Jogar novamente" ja estar
      // certo se o jogo nem chegar a rodar (crash de engine, por exemplo) —
      // voce tentou jogar, e o titulo pertence ao topo da lista.
      return markPlayed(titleId)
        .catch(function () { return null; })
        .then(function () { return call('launchTitle', { titleId: String(titleId || '') }); })
        .then(function (r) {
          if (r && r.ok) return { ok: true };
          return { ok: false, error: (r && r.error) || 'Vita3K não instalado' };
        });
    },

    playStats: function () { return playStats(); },
    libraryMeta: function () { return libraryMeta(); },
    markPlayed: function (titleId) { return markPlayed(titleId); },
    toggleFav: function (titleId) { return toggleFav(titleId); },

checkFirmware: function (region) {
      return call('fwCheck', { region: region || 'us' }).then(function (res) {
        if (res && res.ok && res.info && res.info.url) return res;
        return { ok: false, error: 'Servidores da Sony indisponíveis' };
      });
    },

    downloadFirmware: function (payload) {
      return call('homeDir').then(function (home) {
        const dest = home + '/fw/' + ((payload && payload.name) || 'PSP2UPDAT.PUP');
        // O tamanho vem da lista oficial da Sony; o host aborta o download se
        // o arquivo chegar menor ou maior, em vez de gravar um PUP truncado
        // como se fosse o firmware.
        const args = { url: payload && payload.url, dest: dest };
        if (payload && payload.size > 0) args.size = payload.size;
        if (payload && payload.sha256) args.sha256 = payload.sha256;
        return call('download', args).then(function (r) {
          if (r && typeof r === 'string') return { ok: true, dest: r };
          return { ok: false, error: (r && r.error) || 'Download falhou' };
        });
      });
    },

    installFirmware: function (pup) {
      return loadConfig().then(async function (c) {
        if (!pup) return { ok: false, error: 'arquivo n\u00e3o encontrado' };
        const storage = (await call('storageDir')) || '';
        const dest = storage + '/fw/PSP2UPDAT.PUP';
        const okC = await call('copy', { src: pup, dst: dest });
        if (!okC) return { ok: false, error: 'n\u00e3o foi poss\u00edvel salvar o firmware' };
        const r = await nativeFwInstall(dest);
        if (!(r && r.ok)) return { ok: false, error: (r && r.error) || 'extra\u00e7\u00e3o do firmware falhou' };
        c.fwInstalled = true;
        c.fwVersion = String(r.version || '');
        await saveConfig();
        toastMsg('Firmware ' + c.fwVersion + ' instalado com sucesso');
        return { ok: true, version: c.fwVersion };
      });
    },

    saveOptionalPup: function (payload) {
      return loadConfig().then(async function (c) {
        const kind = payload && (payload.kind === 'font' ? 'font' : payload.kind === 'pre' ? 'pre' : null);
        if (!kind) return { ok: false, error: 'pacote opcional desconhecido' };
        const pup = payload && payload.path;
        if (!pup) return { ok: false, error: 'arquivo não encontrado' };
        const storage = (await call('storageDir')) || '';
        const fname = kind === 'pre' ? 'PSP2UPDPRE.PUP' : 'PSP2UPDATFont.PUP';
        const dest = storage + '/fw/' + fname;
        const okC = await call('copy', { src: pup, dst: dest });
        if (!okC) return { ok: false, error: 'não foi possível salvar o pacote' };
        const r = await call('pupVersion', { path: dest });
        const version = r && r.ok ? String(r.version || '') : '';
        const engineRoot = storage + '/vita';
        const pub = engineRoot + '/ux0/app/PCSF00001/sys/RELEASE/PUB';
        await call('mkdirs', { path: pub });
        const staged = pub + '/' + fname;
        const okS = await call('copy', { src: pup, dst: staged });
        if (kind === 'pre') { c.fwPrePath = dest; c.fwPreVersion = version; }
        else { c.fwFontPath = dest; c.fwFontVersion = version; }
        await saveConfig();
        toastMsg((kind === 'pre' ? 'Pré-instalação' : 'Fontes') + ' instalado' + (version ? ' (' + version + ')' : '') + ' com sucesso');
        return { ok: true, kind: kind, path: dest, version: version, staged: okS ? staged : null };
      });
    },

    setFirmwareManual: function (pup) {
      return this.installFirmware(pup);
    },

    installApp: function (payload) {
      const self = this;
      return call('storageDir').then(async function (storage) {
        try {
          const kind = payload.kind;
          const file = payload.file;
          if (!file) return { ok: false, error: 'sem arquivo' };
          if (kind === 'pkg') {
              let zrifText = payload.zRif || '';
              let workbinPath = '';
              if (!zrifText && payload.key) {
                if (payload.keyKind === 'workbin') {
                  workbinPath = payload.key;
                } else {
                  const keyText = await call('readFile', { path: payload.key });
                  // Em caso de falha o host devolve {ok:false,error}; sem este
                  // typeof o "[object Object]" ia como zRIf e a instalacao
                  // falhava com um erro opaco em vez de "nao consegui ler".
                  if (typeof keyText === 'string' && keyText.trim()) {
                    zrifText = keyText.trim();
                  } else if (keyText && typeof keyText === 'object') {
                    throw new Error(String(keyText.error || 'nao foi possivel ler o arquivo de chave'));
                  }
                }
              }
              const installBase = await self.installDir();
              const r = await call('installPkg', { path: file, zrif: zrifText, workbin: workbinPath, base: installBase });
              if (r && r.ok) {
                const vitaBoot = installBase + '/ux0/app/' + r.titleId + '/eboot.bin';
                const pspBoot = installBase + '/pspemu/PSP/GAME/' + r.titleId + '/EBOOT.PBP';
                const hasVita = await call('exists', { path: vitaBoot });
                const hasPsp = await call('exists', { path: pspBoot });
                if (!hasVita && !hasPsp) {
                  const why = r.pfsError ? ('PFS: ' + r.pfsError) : 'nenhum arquivo foi extraído';
                  return { ok: false, error: 'Instalação vazia — ' + why + ' (verifique o zRIF/work.bin, ' + r.titleId + ')' };
                }
                try {
                  await call('writeFile', {
                    path: r.appDir + '/sce_sys/package/_install.json',
                    content: JSON.stringify({ titleId: r.titleId, kind: r.kind || kind, keyType: r.keyType || 0, itemCount: r.itemCount || 0, pfsFiles: r.pfsFiles != null ? r.pfsFiles : 0, pfsError: r.pfsError || '' }),
                  });
                } catch (e) {}
                // O host ter extraido o eboot nao prova que o jogo entrou na
                // biblioteca -- o "instalado" so vale se a mesma varredura que a
                // Home usa enxergar o titulo. Aqui a instalacao se confere no
                // mesmo instante e devolve o veredito, com o resumo das pastas,
                // para a tela do instalador dizer o que aconteceu em vez de so
                // mostrar um tick verde.
                let libReport = '';
                let inLibrary = true;
                try {
                  const lib = await self.listApps();
                  inLibrary = Array.isArray(lib) && lib.some(function (g) { return g && g.titleId === r.titleId; });
                  libReport = (lib && lib.scanReport) || '';
                } catch (e) {
                  inLibrary = false;
                  libReport = String((e && e.message) || e);
                }
                toastMsg('Jogo instalado: ' + r.titleId);
                return { ok: true, mode: 'standalone', titleId: r.titleId, title: r.title, kind: hasPsp ? 'psp' : 'vita', appDir: r.appDir, inLibrary: inLibrary, libReport: libReport };
              }
              if (r && r.error) {
                console.error('installPkg falhou: ' + r.error);
                return { ok: false, error: String(r.error) };
              }
              return { ok: false, error: 'Falha ao instalar o PKG' };
            }
          const base = (await self.installDir()) || storage + '/VitaHub';
          if (kind === 'vpk') {
            const pre = await self.fileInfo(file);
            if (!pre || !pre.ok) {
              return {
                ok: false,
                error: (pre && pre.error) || 'não consegui ler o pacote',
                size: (pre && pre.size) || 0,
                sha1: (pre && pre.sha1) || '',
              };
            }
            const r = await call('installVpk', { path: file, base: base });
            if (r && r.ok) {
              // Guarda o sha1 do que acabou de instalar. Sem um valor de
              // referencia externo nao da para provar que o arquivo "e o
              // certo" -- mas da para provar que e o MESMO arquivo de antes.
              // Reinstalar o mesmo titulo com hash diferente significa que o
              // segundo download nao e o mesmo arquivo, e isso precisa dizer.
              let changed = false;
              const stamp = r.appDir + '/sce_sys/package/_install.json';
              if (r.appDir && r.titleId) {
                try {
                  const old = JSON.parse(await call('readFile', { path: stamp }) || '{}');
                  if (old.sha1 && pre.sha1 && old.sha1 !== pre.sha1) changed = true;
                  await call('writeFile', {
                    path: stamp,
                    content: JSON.stringify({
                      titleId: r.titleId, kind: 'vpk',
                      sha1: pre.sha1 || '', size: pre.size || 0,
                      entries: pre.entries || 0,
                    }),
                  });
                } catch (e) { /* registro e acessorio: nao pode barrar a instalacao */ }
              }
              toastMsg('Jogo instalado: ' + ((r.title || r.titleId) || ''));
              return {
                ok: true, mode: 'standalone', titleId: r.titleId || '',
                title: r.title || '', kind: r.kind || 'vita',
                sha1: pre.sha1 || '', size: pre.size || 0, changed: changed,
              };
            }
            if (r && r.error) {
              console.error('installVpk falhou: ' + r.error);
              return { ok: false, error: String(r.error) };
            }
            return { ok: false, error: 'Falha ao instalar o VPK' };
          }
          const entries = await call('zipList', { path: file });
          const titleId = detectTitleId(entries);
          const dest = base + '/ux0/app/' + (titleId || 'UNKNOWN');
          const n = await call('extractZip', { zip: file, dest: dest });
          if (n === -1 || n === null) {
            return { ok: false, error: 'Extra\u00e7\u00e3o falhou \u2014 use a pasta padr\u00e3o do app' };
          }
          return { ok: true, mode: 'standalone', titleId: titleId || '' };
        } catch (e) {
          console.error('installApp exceção: ' + ((e && e.message) || e));
          return { ok: false, error: String((e && e.message) || e || 'erro de instala\u00e7\u00e3o') };
        }
      });
    },

    listApps: function () {
      const self = this;
      return self.installDir().then(async function (base) {
        const out = [];
        // listDir devolve null tanto para pasta ausente quanto para pasta que
        // existe mas nao pode ser lida, e os dois casos precisam de tratamento
        // oposto: ausente e o normal (pspemu/PSP/GAME so nasce no primeiro jogo
        // de PSP) e nao pode virar aviso, senao todo aparelho so com jogos Vita
        // recebe "nao consegui ler a pasta" com a biblioteca inteira no ar.
        // So "existe e nao le" e problema, e o resumo das duas arvores vai junto
        // para a tela mostrar quantos jogos foram realmente encontrados.
        const problems = [];
        const summary = [];
        // Orcamento da varredura, em duas camadas: 2,5s por leitura e 5s no
        // total, contados de um unico t0, com parada no meio se estourar.
        //
        // Precisa ficar bem abaixo dos orcamentos de render (9s no boot, em
        // app.js). Duas transicoes de tela racedam a varredura contra um limite
        // e perdem a corrida quando ela passa: no v37 a tela inicial ficava sem
        // render e o app fechava sozinho. Listagem em armazenamento interno
        // leva milissegundos -- 2,5s ja e eventualidade, nao folga.
        const SCAN_MS = 2500;
        const SCAN_TOTAL_MS = 5000;
        const t0 = Date.now();
        const left = function () { return Math.max(500, Math.min(SCAN_MS, SCAN_TOTAL_MS - (Date.now() - t0))); };
        const scan = async function (rel, kind, boot) {
          const root = base + '/' + rel;
          const apps = await call('listDir', { path: root }, left());
          if (!Array.isArray(apps)) {
            const there = await call('exists', { path: root }, left());
            if (there) {
              problems.push(root);
              console.log('listApps: ' + root + ' existe mas nao pode ser lida');
              summary.push(rel + ': ' + t('library_unreadable'));
            } else {
              console.log('listApps: ' + root + ' ainda nao existe');
              summary.push(rel + ': ' + t('library_absent'));
            }
            return;
          }
          const before = out.length;
          let seen = 0;
          let noBoot = 0;
          let expired = 0;
          for (const entry of apps) {
            if (!entry.d) continue;
            seen++;
            if (Date.now() - t0 > SCAN_TOTAL_MS) break;
            const dir = base + '/' + rel + '/' + entry.n;
            const mark = stats.timeouts;
            const hasBoot = await call('exists', { path: dir + '/' + boot }, left());
            if (stats.timeouts > mark) { expired++; continue; }
            if (!hasBoot) { noBoot++; continue; }
            let title = '';
            if (kind === 'vita') {
              title = String((await call('sfoTitle', { path: dir + '/sce_sys/param.sfo' }, left())) || '');
              // Titulo de sistema nao e jogo. O proprio instalador de firmware
              // deixa o AUTOPLUG0 em ux0/app, e a varredura o pegava como se
              // fosse um jogo: abrir o atualizador dentro do emulador quebra a
              // engine. A categoria vem do param.sfo ("sys" = sistema).
              if (title && SYSTEM_TITLES.indexOf(entry.n) >= 0) {
                console.log('listApps: titulo de sistema ignorado: ' + entry.n);
                continue;
              }
              if (title) {
                const cat = String((await call('sfoCategory', { path: dir + '/sce_sys/param.sfo' }, left())) || '');
                if (cat === 'sys') {
                  console.log('listApps: titulo de sistema ignorado (sys): ' + entry.n);
                  continue;
                }
              }
            }
            if (title) {
              out.push({ titleId: entry.n, icon: dir + '/sce_sys/icon0.png', title: title, kind: kind, dir: dir });
            } else {
              out.push({ titleId: entry.n, icon: '', title: '', kind: kind, dir: dir });
            }
          }
          // A linha precisa dizer por que um jogo faltou, nao so quantos
          // faltaram: "0 de 1" tanto descreve uma pasta cuja extracao nao
          // completou quanto um jogo valido descartado por leitura expirada,
          // e as duas causas pedem consertos opostos.
          const found = out.length - before;
          const why = [];
          if (noBoot) why.push(noBoot + ' sem ' + boot);
          if (expired) why.push(expired + ' leitura expirou');
          summary.push(rel + ': ' + found
            + (seen !== found ? ' de ' + seen : '')
            + (why.length ? ' (' + why.join(', ') + ')' : ''));
        };
        await scan('ux0/app', 'vita', 'eboot.bin');
        await scan('pspemu/PSP/GAME', 'psp', 'EBOOT.PBP');
        out.installDir = base;
        out.scanReport = base + ' · ' + summary.join(' · ');
        out.listError = problems.length
          ? t('library_unreadable') + ' (' + problems.join(', ') + ') · ' + summary.join(' · ')
          : '';
        return out;
      });
    },

    installDir: function () {
      return loadConfig().then(async function (c) {
        // O host responde com {ok:false,error} quando o seletor de pasta falha;
        // se esse objeto for salvo como installDir, todo lancamento de jogo passa
        // a montar "[object Object]/ux0/app/..." e nenhum jogo e achado.
        if (typeof c.installDir === 'string' && c.installDir) return c.installDir;
        const d = await call('defaultDir');
        return d || (await call('storageDir')) + '/VitaHub';
      });
    },

    defaultDir: function () { return call('defaultDir'); },

    listDir: function (dirPath) { return call('listDir', { path: dirPath || '' }); },
    copyFile: function (src, dst) { return call('copy', { src: src || '', dst: dst || '' }); },
    move: function (src, dst) { return call('move', { src: src || '', dst: dst || '' }); },
    engineRoot: function () {
      return call('storageDir').then(function (storage) { return (storage || '') + '/vita'; });
    },
    fwInstall: function (path) {
      return nativeFwInstall(path || '');
    },
    migrate: function () {
      const self = this;
      return loadConfig().then(async function (c) {
        const storage = (await call('storageDir')) || '';
        // Onde a BIBLIOTECA olha, e portanto onde a migracao precisa deixar os
        // jogos. Antes este alvo era storage + '/vita' fixo, o que so coincidia
        // com o installDir padrao: com o diretorio escolhido num cartao SD ou
        // pendrive, migrate() movia os jogos da pasta antiga para a arvore
        // interna, que listApps() nunca lista. Os dados ficavam intactos no
        // armazenamento do celular e a biblioteca inteira sumia da tela, sem
        // aviso e sem backup -- o mesmo sintoma de "instalei e nao aparece" que
        // a migracao existe para resolver. Legacy e o que installDir pode ter
        // sobrado de uma versao antiga; nesses casos o alvo e o padrao de novo.
        const legacy = [storage + '/VitaHub', storage];
        let engineRoot = c.installDir;
        if (typeof engineRoot !== 'string' || !engineRoot || legacy.indexOf(engineRoot) !== -1) {
          engineRoot = (await call('defaultDir')) || (storage + '/vita');
        }
        // repaired: quantas pastas quebradas no destino foram guardadas em
        // .sobrou/ para o jogo da pasta antiga entrar. repairedFrom: quais
        // titulos voltaram -- o nome importa, porque "instalei e sumiu" nao tem
        // conserto util sem dizer qual.
        const out = { moved: 0, skipped: 0, repaired: 0, repairedFrom: [], fw: null, engineRoot: engineRoot };
        // Migracao de uma versao so: as pastas ANTIGAS do proprio app. O
        // installDir escolhido pelo usuario nao entra aqui — um cartao SD ou
        // um pendrive escolhido em Config > Armazenamento e destino, nao
        // origem. A versao anterior tratava qualquer installDir como legado e
        // ainda reescrevia a config para a pasta interna, o que devolvia o
        // usuario ao armazenamento do celular a cada abertura do app.
        const legacyRoots = [storage + '/VitaHub'];
        // As duas arvores. A de PSP nunca foi migrada: um jogo de PSP instalado
        // por uma versao antiga ficava preso na pasta antiga para sempre, sem
        // nunca aparecer na biblioteca.
        const trees = ['ux0/app', 'pspemu/PSP/GAME'];
        // O que prova que a pasta e um jogo. Vale para as duas arvores: um
        // Vita pode vir com EBOOT.PBP na raiz (pkg de PSP reempacotado) e um
        // PSP sempre usa EBOOT.PBP.
        const BOOTS = ['/eboot.bin', '/EBOOT.PBP'];
        const isGame = async function (dir) {
          for (const b of BOOTS) {
            if (await call('exists', { path: dir + b })) return true;
          }
          return false;
        };
        if (legacyRoots.length) {
          for (const root of legacyRoots) {
            for (const tree of trees) {
              await call('mkdirs', { path: engineRoot + '/' + tree });
              const apps = await call('listDir', { path: root + '/' + tree });
              if (!Array.isArray(apps)) continue;
              for (const a of apps) {
                if (!a.d) continue;
                const from = root + '/' + tree + '/' + a.n;
                const to = engineRoot + '/' + tree + '/' + a.n;
                // O destino so conta como ocupado se for um JOGO. Pular por
                // existir deixava o jogo do usuario preso na pasta antiga sempre
                // que o destino era o rastro de uma extracao que falhou: a
                // biblioteca lia a arvore nova, encontrava uma pasta sem
                // eboot.bin e reportava "0 de 1", com o jogo de verdade ainda
                // na pasta antiga e nenhuma mensagem na tela.
                if (await isGame(to)) { out.skipped++; continue; }
                // Sobra que NAO e jogo (pasta vazia ou extracao parcial): vai
                // para .sobrou/ em vez de ser apagada, para nao perder nada do
                // usuario. Fica FORA de ux0/app de proposito: binnen da arvore
                // de jogos a pasta entraria na varredura como mais um jogo sem
                // eboot.bin, e o resumo ficaria complaining para sempre.
                if (await call('exists', { path: to })) {
                  const aside = engineRoot + '/.sobrou/' + tree.replace(/\//g, '_') + '/' + a.n;
                  if (await call('exists', { path: aside })) { out.skipped++; continue; }
                  if (!(await call('move', { src: to, dst: aside }))) { out.skipped++; continue; }
                  out.repaired++;
                }
                if (await call('move', { src: from, dst: to })) { out.moved++; out.repairedFrom.push(a.n); }
                else out.skipped++;
              }
            }
          }
          // installDir so e reescrito quando a config ainda aponta para uma
          // das pastas legadas (ou nao aponta para nada). Reescrever so porque
          // houve movimento devolvia o usuario ao armazenamento interno mesmo
          // com a arvore inteira num pendrive escolhido por ele.
          const dirLegacy = typeof c.installDir !== 'string' || !c.installDir
            || legacy.indexOf(c.installDir) !== -1;
          if (dirLegacy && c.installDir !== engineRoot) {
            c.installDir = engineRoot;
            await saveConfig();
          }
        }
        const pup = storage + '/fw/PSP2UPDAT.PUP';
        // O firmware e conferido e instalado na MESMA arvore que a migracao usa
        // e que a engine vai ler: sao a mesma arvore por construcao agora. Antes
        // eram tres noites diferentes -- migrate(), listApps() e o pref-path do
        // config.yml -- e o firmware acabava instalado numa delas enquanto o
        // jogo era procurado em outra, o que dava "sem vs0/sys" com tudo certo
        // no lugar.
        const fwTree = engineRoot;
        const fwReal = await call('exists', { path: fwTree + '/vs0/sys' });
        if (!fwReal && (c.fwInstalled || (await call('exists', { path: pup })))) {
          out.fw = await self.fwInstall(pup);
          if (out.fw && out.fw.ok) {
            c.fwInstalled = true;
            c.fwVersion = String(out.fw.version || '');
            await saveConfig();
          }
        }
        return out;
      });
    },
    base64File: function (p) { return call('base64File', { path: p || '' }); },

    appInfo: function (dir) { return call('appInfo', { path: dir || '' }); },

    deleteApp: function (dir) { return call('deleteApp', { path: dir || '' }); },

    /**
     * Progresso da instalacao de PKG. O host emite o evento durante a
     * extracao; aqui ele vira um objeto com fracao e porcentagem ja
     * arredondada, para a UI nao ter que repetir essa conta.
     * `onProgress(null)` desliga o ouvinte.
     */
    onInstallProgress: function (cb) { events['install:progress'] = cb; },
    openExternal: function (url) { return call('openExternal', { url: url || '' }); },
    openWith: function (uri) { return call('openWith', { uri: uri || '' }); },
    openPkg: function (path) { return call('openWith', { path: path || '' }); },
    mark: function (tag) { return call('mark', { tag: String(tag || '') }); },
    clipboard: function (text) { return call('clipboard', { text: String(text || '') }); },
    cameraTake: function () { return call('cameraTake', {}); },

    toggleFullscreen: function () { return call('toggleUI'); },
    setCursor: function () { return Promise.resolve(true); },
    quit: function () { return call('quit'); },

    onFwProgress: function (cb) { if (cb) events['fw:progress'] = cb; },

    /**
     * Dispara quando o Android monta ou desmonta um volume (pendrive, cartao).
     * `cb(null)` desliga. A Configuracoes usa isso para repreencher a lista
     * sem o usuario precisar sair e voltar da tela.
     */
    onStorageChange: function (cb) { events['storage:changed'] = cb; },
    // Reconhece o arquivo escolhido: tamanho, sha1 e se a estrutura do pacote
    // fecha. O app chama isto ANTES de instalar para conseguir dizer "o download
    // parou no meio" em vez de propagar um erro opaco do host.
    fileInfo: function (file) { return call('fileInfo', { path: file }); },

    onCursor: function () {},
    onFullscreen: function () {},
  };
})();