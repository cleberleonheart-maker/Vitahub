'use strict';

const Wizard = (() => {
  const els = {
    list: () => document.getElementById('lang-list'),
    fwVer: () => document.getElementById('fw-ver'),
    fwErr: () => document.getElementById('fw-err'),
    fwBarWrap: () => document.getElementById('fw-bar-wrap'),
    fwBarFill: () => document.getElementById('fw-bar-fill'),
    fwMeta: () => document.getElementById('fw-meta'),
    fwDl: () => document.getElementById('fw-dl-btn'),
    dirInput: () => document.getElementById('dir-input'),
  };

  let selectedLang = 'pt-BR';
  let fwState = { version: null, pupPath: null, pre: null, font: null, installed: false, preDone: false, fontDone: false };
  let fwActive = 'main';

  const FW_NAMES = { pre: 'PSP2UPDPRE.PUP', font: 'PSP2UPDATFont.PUP' };

  function go(step) {
    document.querySelectorAll('#screen-wizard .wz-step').forEach((el) => {
      const on = el.dataset.step === step;
      if (on) {
        el.dataset.active = 'true';
        if (step === 'lang') buildLangList();
        if (step === 'fw') { resetFwActions(); startFirmwareCheck(); }
        if (step === 'dir') refreshDir();
      } else {
        el.removeAttribute('data-active');
      }
    });
  }

  function buildLangList() {
    const list = els.list();
    list.innerHTML = '';
    const order = (l) => l.order || l.code;
    [...LANGUAGES].sort((a, b) => (order(a) > order(b) ? 1 : -1)).forEach((l) => {
      const li = document.createElement('li');
      li.dataset.code = l.code;
      li.innerHTML = `<span class="lang-name"></span><span class="lang-native"></span>`;
      li.querySelector('.lang-name').textContent = l.name;
      li.querySelector('.lang-native').textContent = l.native;
      if (l.code === selectedLang) li.classList.add('sel');
      li.addEventListener('click', () => {
        selectedLang = l.code;
        document.querySelectorAll('#lang-list li').forEach((x) => x.classList.remove('sel'));
        li.classList.add('sel');
        setTimeout(() => go('fw'), 480);
      });
      list.appendChild(li);
    });
  }

  async function startFirmwareCheck() {
    const cfg = await window.vitahub.getConfig();
    const region = (cfg.settings && cfg.settings.region) || 'us';
    els.fwVer().textContent = t('fw_checking');
    els.fwErr().textContent = '';
    try {
      const res = await window.vitahub.checkFirmware(region);
      if (res.ok) {
        const info = res.info || {};
        fwState = {
          version: info.version || '3.74',
          url: info.url,
          size: info.size,
          pre: info.pre && info.pre.url ? { url: info.pre.url, size: info.pre.size } : null,
          font: info.font && info.font.url ? { url: info.font.url, size: info.font.size } : null,
        };
        els.fwVer().textContent = `${t('fw_found', fwState.version)} ${fmtBytes(info.size)}`;
        renderExtras();
      } else {
        fwState = { version: '3.74 + update', url: null, size: null, pre: null, font: null, installed: false, preDone: false, fontDone: false };
        els.fwVer().textContent = t('fw_found', '3.74');
        els.fwErr().textContent = `${t('toast_error')}: ${res.error}`;
      }
    } catch {
      fwState = { version: '3.74', url: null, size: null, pre: null, font: null, installed: false, preDone: false, fontDone: false };
    }
  }

  function fwEl(kind, suffix) {
    return document.getElementById(kind === 'main' ? suffix : 'fw-' + kind + '-' + suffix);
  }

  function renderExtras() {
    const box = document.getElementById('fw-extras');
    const hasAny = fwState.pre || fwState.font;
    box.classList.toggle('hidden', !hasAny);
    ['pre', 'font'].forEach((kind) => {
      const info = fwState[kind];
      const row = document.getElementById('fw-extra-' + kind);
      const btn = fwEl(kind, 'btn');
      const sizeEl = fwEl(kind, 'size');
      if (!info) { row.classList.add('hidden'); return; }
      row.classList.remove('hidden');
      sizeEl.textContent = fmtBytes(info.size) || '';
      btn.textContent = t(kind === 'pre' ? 'fw_pre_dl' : 'fw_font_dl');
      btn.disabled = false;
      fwEl(kind, 'state').textContent = '';
    });
  }

  function updateFwBar(p) {
    const kind = fwActive;
    if (kind === 'main') {
      els.fwBarFill().style.width = pctOf(p) + '%';
      els.fwMeta().textContent = `${t('fw_downloading')} ${fmtBytes(p.bytes)}/${fmtBytes(p.total)}${p.speed ? ` · ${fmtBytes(p.speed)}/s` : ''}`;
    } else {
      fwEl(kind, 'fill').style.width = pctOf(p) + '%';
      fwEl(kind, 'meta').textContent = `${fmtBytes(p.bytes)}/${fmtBytes(p.total)}${p.speed ? ` · ${fmtBytes(p.speed)}/s` : ''}`;
    }
  }

  function pctOf(p) {
    return p.total ? Math.min(100, Math.round((p.bytes / p.total) * 100)) : 0;
  }

  function updateFwNext() {
    const next = document.getElementById('fw-next-btn');
    const skip = document.getElementById('fw-skip-btn');
    if (!next) return;
    // Firmware e recomendacao, nao requisito: o pacote de fontes e opcional e
    // os servidores da Sony caem com frequencia. Exigir os dois deixava a tela
    // sem nenhuma saida, sem botao de "pular".
    const ready = !!fwState.installed;
    next.classList.toggle('hidden', !ready);
    if (skip) skip.classList.toggle('hidden', ready);
    const warn = document.getElementById('fw-skip-warn');
    if (warn) warn.classList.toggle('hidden', ready);
    if (ready) {
      ['fw-dl-btn', 'fw-manual-btn', 'fw-site-btn'].forEach((id) => {
        const b = document.getElementById(id);
        if (b) b.classList.add('hidden');
      });
    }
  }

  function resetFwActions() {
    const next = document.getElementById('fw-next-btn');
    if (next) next.classList.add('hidden');
    ['fw-dl-btn', 'fw-manual-btn', 'fw-site-btn'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.classList.remove('hidden');
    });
  }

  function openFwSite() {
    const REGION_LANG = {
      us: 'en-us', gb: 'en-gb', au: 'en-au', ie: 'en-ie',
      jp: 'ja-jp', kr: 'ko-kr', tw: 'zh-hant-tw', hk: 'zh-hant-hk',
      de: 'de-de', fr: 'fr-fr', it: 'it-it', es: 'es-es',
      br: 'pt-br', mx: 'es-mx', eu: 'en-gb',
    };
    window.vitahub.getConfig().then((cfg) => {
      const region = (cfg.settings && cfg.settings.region) || 'us';
      const lang = REGION_LANG[region] || 'en-us';
      window.vitahub.openExternal(`https://www.playstation.com/${lang}/support/hardware/psvita/system-software/`).then((ok) => {
        if (!ok) els.fwErr().textContent = `${t('toast_error')}: openExternal`;
      });
    });
  }

  async function downloadOptional(kind) {
    const info = fwState[kind];
    if (!info || !info.url) return;
    const btn = fwEl(kind, 'btn');
    const state = fwEl(kind, 'state');
    const bar = document.getElementById('fw-' + kind + '-bar');
    btn.disabled = true;
    els.fwDl().disabled = true;
    const enableAll = () => {
      ['pre', 'font'].forEach((k) => { fwEl(k, 'btn').disabled = false; });
      els.fwDl().disabled = false;
    };
    ['pre', 'font'].forEach((k) => { fwEl(k, 'btn').disabled = true; });
    fwActive = kind;
    bar.classList.remove('hidden');
    state.textContent = '';
    fwEl(kind, 'fill').style.width = '2%';

    const dst = await window.vitahub.downloadFirmware({ url: info.url, name: FW_NAMES[kind], size: info.size });
    if (!dst.ok) {
      state.textContent = `${t('fw_extra_err')}: ${dst.error}`;
      fwActive = 'main';
      enableAll();
      bar.classList.add('hidden');
      return;
    }
    const sav = await window.vitahub.saveOptionalPup({ path: dst.dest, kind: kind });
    if (!sav.ok) {
      state.textContent = `${t('fw_extra_err')}: ${sav.error}`;
      fwActive = 'main';
      enableAll();
      bar.classList.add('hidden');
      return;
    }
    fwEl(kind, 'fill').style.width = '100%';
    state.textContent = t('fw_extra_ok');
    fwActive = 'main';
    enableAll();
    fwState[kind + 'Path'] = dst.dest;
    if (kind === 'pre') fwState.preDone = true;
    else fwState.fontDone = true;
    updateFwNext();
    bar.classList.add('hidden');
  }

  async function downloadAndInstall() {
    const btn = els.fwDl();
    btn.disabled = true;
    fwActive = 'main';
    ['pre', 'font'].forEach((k) => { fwEl(k, 'btn').disabled = true; });
    els.fwBarWrap().classList.remove('hidden');
    els.fwBarFill().style.width = '2%';
    els.fwMeta().textContent = t('fw_downloading');

    let info = fwState;
    if (!info.url) {
      try {
        const cfg = await window.vitahub.getConfig();
        const res = await window.vitahub.checkFirmware((cfg.settings && cfg.settings.region) || 'us');
        if (res.ok && res.info.url) info = { version: res.info.version, url: res.info.url };
        else throw new Error('no-update-url');
      } catch {
        els.fwMeta().textContent = t('toast_error') + ': ' + t('fw_manual');
        btn.disabled = false;
        ['pre', 'font'].forEach((k) => { fwEl(k, 'btn').disabled = false; });
        return;
      }
    }

    const res = await window.vitahub.downloadFirmware({ url: info.url, size: info.size });
    if (!res.ok) {
      els.fwErr().textContent = t('toast_error') + ': ' + res.error;
      btn.disabled = false;
      ['pre', 'font'].forEach((k) => { fwEl(k, 'btn').disabled = false; });
      return;
    }
    els.fwMeta().textContent = t('fw_installing');
    const inst = await window.vitahub.installFirmware(res.dest);
    if (!inst.ok) {
      els.fwErr().textContent = t('toast_error') + ': ' + inst.error;
      btn.disabled = false;
      ['pre', 'font'].forEach((k) => { fwEl(k, 'btn').disabled = false; });
      return;
    }
    fwState.installed = true;
    fwState.pupPath = res.dest;
    els.fwVer().textContent = t('fw_done');
    els.fwMeta().textContent = `${t('set_fw')}: ${inst.version || '3.74'}`;
    els.fwBarFill().style.width = '100%';
    btn.disabled = false;
    ['pre', 'font'].forEach((k) => { fwEl(k, 'btn').disabled = false; });
    updateFwNext();
  }

  async function manualInstall() {
    const file = await window.vitahub.pickFile({
      title: t('fw_pick'),
      filters: [{ name: 'Firmware', extensions: ['pup'] }],
    });
    if (!file) return;
    els.fwBarWrap().classList.remove('hidden');
    els.fwBarFill().style.width = '30%';
    els.fwMeta().textContent = t('fw_installing');
    const res = await window.vitahub.installFirmware(file);
    if (!res.ok) {
      els.fwErr().textContent = t('toast_error') + ': ' + (res.error || '');
      return;
    }
    els.fwVer().textContent = t('fw_done');
    els.fwMeta().textContent = `${t('set_fw')}: ${res.version || '3.74'}`;
    els.fwBarFill().style.width = '100%';
    fwState.installed = true;
    fwState.pupPath = file;
    updateFwNext();
  }

  function refreshDir() {
    window.vitahub.getConfig().then((cfg) => {
      els.dirInput().value = cfg.installDir || pathDefault();
    });
  }
  function pathDefault() {
    const cfg = window.vitahub.getConfig;
    void cfg;
    return '';
  }

  function bind() {
    document.getElementById('wz-welcome-next').addEventListener('click', () => go('lang'));
    document.getElementById('fw-dl-btn').addEventListener('click', () => downloadAndInstall());
    document.getElementById('fw-manual-btn').addEventListener('click', () => manualInstall());
    document.getElementById('fw-site-btn').addEventListener('click', () => openFwSite());
    document.getElementById('fw-next-btn').addEventListener('click', () => go('dir'));
    document.getElementById('fw-skip-btn').addEventListener('click', () => go('dir'));
    document.getElementById('fw-pre-btn').addEventListener('click', () => downloadOptional('pre'));
    document.getElementById('fw-font-btn').addEventListener('click', () => downloadOptional('font'));
    window.vitahub.onFwProgress((p) => updateFwBar(p));
    document.getElementById('dir-browse').addEventListener('click', async () => {
      const cfg = await window.vitahub.getConfig();
      const p = await window.vitahub.pickDirectory(cfg.installDir);
      if (p) els.dirInput().value = p;
    });
    document.getElementById('dir-next').addEventListener('click', async () => {
      const dirVal = els.dirInput().value.trim();
      await window.vitahub.setConfig({ lang: selectedLang, installDir: dirVal || (await window.vitahub.getConfig()).installDir });
      showScreen('user');
    });

    // ---- user creation (screen-user)
    let avatarIdx = 0;
    const avatarEl = () => document.getElementById('avatar-svg');
    const renderAvatar = () => { avatarEl().innerHTML = avatarSvg(avatarIdx, 96); };
    document.getElementById('avatar-prev').addEventListener('click', () => { avatarIdx--; renderAvatar(); });
    document.getElementById('avatar-next').addEventListener('click', () => { avatarIdx++; renderAvatar(); });
    const nameInput = document.getElementById('user-name');
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    document.getElementById('user-create').addEventListener('click', async () => {
      try {
        const name = nameInput.value.trim() || 'VitaHub';
        const avatar = ((avatarIdx % AVATARS.length) + AVATARS.length) % AVATARS.length;
        const cfg = await window.vitahub.getConfig();
        const users = Array.isArray(cfg.users) ? cfg.users.slice() : [];
        const entry = { name, avatar };
        const at = users.findIndex((u) => u.name === name);
        if (at >= 0) users[at] = entry; else users.push(entry);
        await window.vitahub.setConfig({ user: name, avatar, wizardDone: true, users });
        await Lock.refresh();
        enterProfile();
      } catch (e) {
        // Sem este catch uma falha de escrita do config.json era só uma
        // rejeição sem dono: o botão não fazia nada e o assistente ficava
        // parado, igual ao sintoma do toque que não saía da tela de usuário.
        console.error('user-create:', (e && e.message) || e);
        toast(t('toast_error') + ': ' + ((e && e.message) || e), true);
      }
    });
    renderAvatar();
  }

  function escEl(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /**
   * Entra no perfil escolhido. A troca de tela NÃO espera a varredura da
   * biblioteca: Home.render() -> listApps() percorre ux0/app e
   * pspemu/PSP/GAME e, com muitos jogos num cartão lento, isso leva segundos.
   * Enquanto a ponte não responde, a WebView não processa toque nenhum — o
   * sintoma era "cliquei no usuário e nada aconteceu", sem erro e sem toast.
   * A tela de bloqueio entra na hora e a home é montada em segundo plano.
   */
  function enterProfile() {
    showScreen('lock');
    Home.refresh().catch((e) => {
      console.error('Home.refresh:', (e && e.message) || e);
    });
  }

  function selectUser(u) {
    return window.vitahub.setConfig({ user: u.name, avatar: u.avatar || 0 }).then(async () => {
      await Lock.refresh();
      enterProfile();
    }).catch((e) => {
      console.error('selectUser:', (e && e.message) || e);
      toast(t('toast_error') + ': ' + ((e && e.message) || e), true);
    });
  }

  async function renderUserPick() {
    const list = document.getElementById('userpick-list');
    list.innerHTML = '';
    const cfg = await window.vitahub.getConfig();
    const users = Array.isArray(cfg.users) && cfg.users.length ? cfg.users : [];
    if (!users.length) {
      users.push({ name: cfg.user || 'VitaHub', avatar: cfg.avatar || 0 });
      await window.vitahub.setConfig({ users });
    }
    const cur = cfg.user || '';
    users.forEach((u, i) => {
      const card = document.createElement('div');
      card.className = 'userpick-card' + (u.name === cur ? ' current' : '');
      card.innerHTML = `
        <div class="userpick-ava">${avatarSvg(u.avatar || 0, 84)}</div>
        <div class="userpick-name">${escEl(u.name)}</div>
        <div class="userpick-tag">${String(i + 1).padStart(2, '0')}</div>`;
      card.addEventListener('click', () => selectUser(u));
      list.appendChild(card);
    });
    const add = document.createElement('div');
    add.className = 'userpick-card';
    add.id = 'userpick-new';
    add.innerHTML = `
      <div class="userpick-ava" style="display:grid;place-items:center;background:rgba(255,255,255,0.08);font-size:48px;color:rgba(255,255,255,0.75)">+</div>
      <div class="userpick-name">${escEl(t('userpick_new'))}</div>`;
    add.addEventListener('click', () => {
      document.getElementById('user-name').value = '';
      showScreen('user');
      setTimeout(() => document.getElementById('user-name').focus(), 200);
    });

    // Cards sao <div>: sem tabindex nao recebem foco e Enter nao tem o que
    // acionar. O app e navegado por controle/teclado, entao teclado aqui e
    // obrigatorio, nao extra.
    const cards = Array.prototype.slice.call(list.querySelectorAll('.userpick-card'));
    cards.forEach((c) => {
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          c.click();
        }
      });
    });
    // setas movem o foco entre os cards; 'list' persiste entre renders, entao
    // o listener e registrado uma vez so.
    if (!list.dataset.kbnav) {
      list.dataset.kbnav = '1';
      list.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const items = Array.prototype.slice.call(list.querySelectorAll('.userpick-card'));
        if (!items.length) return;
        const at = items.indexOf(document.activeElement);
        const next = items[((at < 0 ? 0 : at) + step + items.length) % items.length];
        if (next) next.focus();
      });
    }
    const focusTarget = list.querySelector('.userpick-card.current') || cards[0];
    if (focusTarget) focusTarget.focus();
    list.appendChild(add);
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  return { init: bind, go, renderUserPick, selectUser };
})();