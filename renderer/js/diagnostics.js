'use strict';

/**
 * Diagnostico dentro do app: como a sessao anterior terminou e o log de cada
 * camada.
 *
 * <p>Dois problemas que apareceram na pratica e que motivam este modulo:
 *
 * <p>1) Crash nativo nao passa pelo CrashLog (que so enxerga excecao Java) e,
 *    nesta familia de aparelhos, nem o logcat nem o Android/data sao legiveis
 *    de fora. Um SIGSEGV deixava zero rastro. ExitWatchdog agora consulta o
 *    historico de saida do proprio processo e a home avisa quando a sessao
 *    morreu de forma anormal, com sinal e trace.
 *
 * <p>2) Diagnosticar exigia extrair o log da pasta do app para o Download e ler
 *    por shell. Aqui o log e lido pela bridge, e as repeticoes vem colapsadas:
 *    sem isso uma falha de apresentacao repete a mesma linha milhares de vezes
 *    e a informacao que importa some no ruido.
 */
const Diagnostics = (() => {
  let current = 'app';
  let open = false;

  const el = (id) => document.getElementById(id);

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function fmtAgo(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'min';
    return Math.round(s / 3600) + 'h';
  }

  function reasonText(info) {
    const n = info.reasonName || '';
    if (n === 'CRASH_NATIVE') return t('crash_native') + (info.signal ? ' (' + info.signal + ')' : '');
    if (n === 'CRASH') return t('crash_java');
    if (n === 'ANR') return t('crash_anr');
    if (n === 'EXCESSIVE_RESOURCE_USAGE') return t('crash_mem');
    return n;
  }

  function showCrashNote(info) {
    const box = el('crash-note');
    if (!box || !info || info.abnormal !== true) return;
    const parts = [reasonText(info)];
    if (info.uptimeMs) parts.push(t('crash_after', fmtAgo(info.uptimeMs)));
    if (info.pssKb) parts.push(t('crash_mem_used', fmtBytes(info.pssKb * 1024)));
    el('crash-note-title').textContent = t('crash_title');
    el('crash-note-body').textContent = parts.join(' · ');
    box.hidden = false;
  }

  async function loadExit() {
    try {
      const info = await window.vitahub.lastExit();
      if (info && Object.keys(info).length) showCrashNote(info);
    } catch (e) {
      console.log('Diagnostics: lastExit indisponivel', e);
    }
  }

  async function load() {
    const body = el('logview-body');
    const meta = el('logview-meta');
    if (!body) return;
    body.textContent = t('logview_loading');
    try {
      const r = await window.vitahub.readLog(current, 400000);
      if (!r || !r.exists) {
        body.textContent = t('logview_empty', r ? r.which : current);
        if (meta) meta.textContent = '';
        return;
      }
      body.textContent = r.text || '';
      if (meta) {
        meta.textContent = fmtBytes(r.bytes) + (r.truncated ? ' · ' + t('logview_truncated') : '');
      }
      // Fica no fim: o que importa numa falha e a ultima linha.
      body.scrollTop = body.scrollHeight;
    } catch (e) {
      body.textContent = t('logview_error') + ' ' + e;
    }
  }

  function select(which) {
    current = which;
    document.querySelectorAll('.logview-tab[data-log]').forEach((b) => {
      b.classList.toggle('on', b.dataset.log === which);
    });
    load();
  }

  function toggle(force) {
    const v = el('logview');
    if (!v) return;
    open = force === undefined ? !open : force;
    v.hidden = !open;
    if (open) load();
  }

  function bind() {
    document.querySelectorAll('.logview-tab[data-log]').forEach((b) => {
      b.addEventListener('click', () => select(b.dataset.log));
    });
    const refresh = el('logview-refresh');
    if (refresh) refresh.addEventListener('click', load);
    const close = el('logview-close');
    if (close) close.addEventListener('click', () => toggle(false));

    const note = el('crash-note-close');
    if (note) note.addEventListener('click', () => { el('crash-note').hidden = true; });
    const logs = el('crash-note-logs');
    if (logs) logs.addEventListener('click', () => toggle(true));
  }

  return { init: loadExit, bind, toggle, select, reload: load };
})();
