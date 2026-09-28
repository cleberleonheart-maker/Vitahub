'use strict';

/**
 * Migracao da biblioteca para /storage/emulated/0/VitaHub.
 *
 * <p>Fica num modulo proprio porque tem duas responsabilidades que nao combine
 * com o resto do boot: falar com o usuario antes e depois (esta e a unica
 * operacao do app que pode levar minutos), e nunca repetir trabalho caro sem
 * necessidade -- a migracao roda a cada abertura, entao 99% das vezes tem de
 * sair em milissegundos dizendo "nao ha nada a fazer".
 *
 * <p>A ordem das operacoes que importam esta em migrateToShared() (JS), nao
 * aqui: permissao, espaco, copia, verificacao por tamanho, troca da config e
 * so entao remocao da origem.
 */
const SharedMigration = (() => {
  const el = (id) => document.getElementById(id);

  let running = false;

  /** Mesma convencao dos outros modulos: MB com uma casa, GB sem. */
  function fmtBytes(n) {
    if (!n || n < 0) return '0 MB';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(1) + ' GB';
  }

  function show() {
    const m = el('migrate-modal');
    if (m) m.classList.remove('hidden');
  }
  function hide() {
    const m = el('migrate-modal');
    if (m) m.classList.add('hidden');
  }

  function paint(done, total) {
    const fill = el('mig-bar-fill');
    const label = el('mig-bar-label');
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = t('mig_copying', '') + ' ' + pct + '%';
  }

  function finish(msgKey) {
    const bar = el('mig-bar');
    const fill = el('mig-bar-fill');
    const label = el('mig-bar-label');
    if (bar) bar.classList.add('hidden');
    if (fill) fill.style.width = '100%';
    if (label) label.textContent = t(msgKey, '');
    const d = el('mig-dismiss');
    if (d) d.classList.remove('hidden');
    toast(t(msgKey, ''));
  }

  async function start() {
    if (running) return null;
    running = true;
    const PT = !!(window.vitahub && window.vitahub.onMigrateProgress);
    try {
      // Consulta barata primeiro: installDir, destino e se ainda ha o que
      // mover. Se nada disso mudar, o modal nem aparece -- abrir um modal a
      // cada boot seria pior que o problema que ele resolve.
      const plan = await window.vitahub.migrateToSharedPlan();
      if (!plan) return null;
      if (!plan.needed) {
        // "Nada a fazer" e o caso normal de toda abertura depois da migracao.
        // Motivos que exigem acao do usuario viram aviso; os benignos ficam
        // calados, senao o app reclama no boot de coisas que ele mesmo resolve.
        const k = reasonKey(plan.reason);
        if (k) toast(t(k, ''));
        return plan;
      }

      show();
      const from = el('mig-from');
      const to = el('mig-to');
      if (from) from.textContent = plan.from;
      if (to) to.textContent = plan.to;
      const label = el('mig-bar-label');
      // Quanto vai ser copiado, antes de comecar. Uma barra que so mostra
      // porcentagem deixa o usuario sem ideia de quanto tempo falta.
      if (label) label.textContent = t('mig_will_copy', '') + ' ' + fmtBytes(plan.bytes || 0);
      paint(0, plan.bytes || 0);

      if (PT) {
        window.vitahub.onMigrateProgress(function (d) {
          if (d) paint(d.bytes || 0, d.total || plan.bytes || 0);
        });
      }

      const r = await window.vitahub.migrateToShared();
      if (!r) return null;
      if (r.ok) finish(r.removed ? 'mig_done' : 'mig_done_kept');
      else finish(reasonKey(r.reason));
      return r;
    } catch (e) {
      console.error('SharedMigration:', (e && e.message) || e);
      finish('mig_failed');
      return null;
    } finally {
      // O botao "Entendi" ja tem listener em bind(). Nao se registra outro
      // aqui: dois handlers para o mesmo clique fecham o modal duas vezes e
      // nenhuma delas tem motivo.
      running = false;
    }
  }

  // Motivos que exigem alguma coisa do usuario. 'fora', 'vazio', 'igual',
  // 'destino-privado' e 'medicao-falhou' NAO aparecem: sao "nao ha migracao a
  // fazer" e happens no caminho normal.
  const NEEDS_USER = {
    'sem-permissao': 'mig_need_perm',
    'espaco': 'mig_no_space',
    'destino-ocupado': 'mig_busy',
  };

  function reasonKey(reason) {
    if (NEEDS_USER[reason]) return NEEDS_USER[reason];
    return reason ? 'mig_failed' : '';
  }

  function bind() {
    const d = el('mig-dismiss');
    if (d) d.addEventListener('click', hide);
  }

  return { start, bind, hide };
})();
