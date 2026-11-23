'use strict';
(() => {
  document.querySelector('.app').style.display = 'none';
  const legacy = (() => { try { return JSON.parse(localStorage.getItem('sa_db') || 'null'); } catch { return null; } })();
  let user = null;
  const request = async (path, options = {}) => {
    const response = await fetch('/api' + path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Falha na comunicação com o servidor.');
    return data;
  };
  const showAuth = (mode = 'login', message = '') => {
    document.querySelector('.app').style.display = 'none';
    let root = document.getElementById('auth-screen');
    if (!root) { root = document.createElement('div'); root.id = 'auth-screen'; document.body.appendChild(root); }
    const token = new URLSearchParams(location.search).get('reset') || '';
    const titles = { login: 'Entrar', register: 'Criar conta por convite', forgot: 'Recuperar senha', reset: 'Nova senha' };
    root.innerHTML = `<div class="card" style="max-width:430px;margin:7vh auto;padding:24px"><h1>🌱 Soil Analysis</h1><h2>${titles[mode]}</h2><p class="note">Acesse suas propriedades, pastagens e análises.</p><form id="auth-form"><div class="fg">${mode === 'register' ? '<label>Nome<input name="name" required maxlength="120"></label>' : ''}${mode !== 'reset' ? '<label>E-mail<input name="email" type="email" required></label>' : ''}${['login','register','reset'].includes(mode) ? '<label>Senha<input name="password" type="password" minlength="10" required></label>' : ''}${mode === 'register' ? '<label>Código de convite<input name="inviteCode" required></label>' : ''}${mode === 'reset' ? `<input type="hidden" name="token" value="${token}">` : ''}</div><div class="err">${message}</div><button class="btn" style="margin-top:12px;width:100%">${mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : mode === 'forgot' ? 'Enviar instruções' : 'Alterar senha'}</button></form><div class="row" style="margin-top:12px"><button class="btn s sm" onclick="SoilAuth.show('login')">Login</button><button class="btn s sm" onclick="SoilAuth.show('forgot')">Esqueci a senha</button><button class="btn s sm" onclick="SoilAuth.show('register')">Tenho convite</button></div></div>`;
    root.querySelector('#auth-form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
      try {
        if (mode === 'login') { await request('/auth/login', { method: 'POST', body: JSON.stringify(data) }); history.replaceState({}, '', location.pathname); await boot(); }
        if (mode === 'register') { await request('/auth/register', { method: 'POST', body: JSON.stringify(data) }); await boot(); }
        if (mode === 'forgot') { const result = await request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }); showAuth('login', result.message); }
        if (mode === 'reset') { await request('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }); history.replaceState({}, '', location.pathname); showAuth('login', 'Senha alterada. Entre com a nova senha.'); }
      } catch (error) { form.querySelector('.err').textContent = error.message; }
    });
  };
  const boot = async () => {
    try { user = (await request('/auth/me')).user; } catch { showAuth(new URLSearchParams(location.search).has('reset') ? 'reset' : 'login'); return; }
    document.getElementById('auth-screen')?.remove(); document.querySelector('.app').style.display = 'flex';
    try {
      const [p, pa, a] = await Promise.all([request('/properties'), request('/pastures'), request('/analyses')]);
      db = { props: p.items || [], pastos: (pa.items || []).map(x => ({ ...x, prop: x.prop || x.property_id })), analises: (a.items || []).map(x => ({ ...x, prop: x.prop || x.property_id, pasto: x.pasto || x.pasture_id })) };
      db.pastos.forEach(x => { x.area = String(x.area ?? ''); if (x.data) x.data = String(x.data).slice(0,10); });
      db.props.forEach(x => { x.area = String(x.area ?? ''); });
      db.analises.forEach(x => { if (x.data) x.data = String(x.data).slice(0,10); ['ph','mo','al','hal','p','k','ca','mg','sb','ctc','v','argila'].forEach(k => { if (x[k] != null) x[k] = String(x[k]); }); });
      if (legacy && !localStorage.getItem('sa_db_migrated') && !sessionStorage.getItem('sa_migration_skipped')) {
        const count = (legacy.props || []).length + (legacy.pastos || []).length + (legacy.analises || []).length;
        if (count && confirm(`Encontramos ${count} registros antigos neste navegador. Importar para sua conta? Os dados locais não serão apagados.`)) {
          const result = await request('/migration/import', { method: 'POST', body: JSON.stringify({ data: legacy }) });
          localStorage.setItem('sa_db_migrated', '1');
          alert(result.alreadyImported ? 'Estes dados já haviam sido importados.' : `Importação concluída: ${result.counts.properties} propriedades, ${result.counts.pastures} pastagens e ${result.counts.analyses} análises.`);
          if (result.imported) { sessionStorage.setItem('sa_migration_skipped','1'); return boot(); }
        } else sessionStorage.setItem('sa_migration_skipped', '1');
      }
      render();
    } catch (error) { toast(error.message, 1); render(); }
  };
  window.SoilAuth = { show: showAuth, logout: async () => { try { await request('/auth/logout', { method: 'POST' }); } catch {} user = null; db = { props: [], pastos: [], analises: [] }; showAuth('login'); } };
  window.sub = async (event, kind) => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const errors = [];
    SCH[kind].flatMap(group => group.f).forEach(field => { const value = (data[field.k] || '').trim(); data[field.k] = value; if (field.r && !value) errors.push(field.l + ': obrigatório'); else if (field.t === 'number' && value && (!Number.isFinite(Number(value)) || Number(value) < 0 || (field.min && Number(value) < field.min) || (field.max && Number(value) > field.max))) errors.push(field.l + ': valor inválido'); });
    if (errors.length) { form.querySelector('.err').textContent = errors.join(' | '); return false; }
    if (kind === 'analises') calc(data); const id = ed[kind] || uid(); const endpoint = { props: 'properties', pastos: 'pastures', analises: 'analyses' }[kind];
    try {
      const result = await request('/' + endpoint + (ed[kind] ? '/' + encodeURIComponent(id) : ''), { method: ed[kind] ? 'PUT' : 'POST', body: JSON.stringify({ ...data, id }) });
      const item = result.item || { ...data, id }; const normalized = kind === 'pastos' ? { ...item, prop: item.prop || item.property_id } : kind === 'analises' ? { ...item, prop: item.prop || item.property_id, pasto: item.pasto || item.pasture_id } : item;
      if (ed[kind]) { const index = db[kind].findIndex(x => x.id == id); if (index >= 0) db[kind][index] = normalized; } else db[kind].push(normalized);
      ed[kind] = null; toast('Registro salvo com sucesso'); if (kind === 'analises') location.hash = 'resultado-' + id; else render();
    } catch (error) { form.querySelector('.err').textContent = error.message; toast(error.message, 1); }
    return false;
  };
  window.del = async (kind, id) => {
    if (!confirm('Excluir este registro? Os registros vinculados também serão excluídos.')) return;
    const endpoint = { props: 'properties', pastos: 'pastures', analises: 'analyses' }[kind];
    try { await request('/' + endpoint + '/' + encodeURIComponent(id), { method: 'DELETE' });
      if (kind === 'props') { const ids = db.pastos.filter(x => x.prop == id).map(x => x.id); db.pastos = db.pastos.filter(x => x.prop != id); db.analises = db.analises.filter(x => x.prop != id && !ids.includes(x.pasto)); }
      if (kind === 'pastos') db.analises = db.analises.filter(x => x.pasto != id);
      db[kind] = db[kind].filter(x => x.id != id); toast('Registro excluído'); render();
    } catch (error) { toast(error.message, 1); }
  };
  window.demo = () => toast('Dados de exemplo desativados nesta versão.', 1);
  window.clr = () => toast('A exclusão de dados é feita individualmente pela lista de registros.', 1);
  const originalRender = window.render;
  window.render = () => { originalRender(); const nav = document.getElementById('nav'); if (nav && user) nav.insertAdjacentHTML('beforeend', `<a href="#config">👤 ${user.name}</a>`); };
  V.config = () => main(`<h1>Configurações</h1><div class="card"><h2>Conta</h2><p>Conectado como <b>${esc(user?.name || '')}</b> (${esc(user?.email || '')}). Seus dados ficam sincronizados pelo banco de dados.</p><button class="btn d" onclick="SoilAuth.logout()">Sair da conta</button></div><div class="card"><h2>Sobre</h2><p>Soil Analysis: sistema de cadastro e interpretação de análises de solo em pastagens. As interpretações são orientativas e não substituem a avaliação de um engenheiro agrônomo.</p></div>`);
  window.addEventListener('load', boot);
})();