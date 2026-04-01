const $ = (sel) => document.querySelector(sel);

let selectedBotId = null;

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || r.statusText || '请求失败');
    err.detail = data.detail;
    err.status = r.status;
    throw err;
  }
  return data;
}

async function refreshHealth() {
  const el = $('#health');
  try {
    const h = await api('/api/health');
    el.className = 'health ' + (h.hasToken ? 'ok' : 'bad');
    el.textContent = h.hasToken
      ? `API 就绪 · ${h.baseURL}`
      : '未配置 COZE_API_TOKEN，请在项目根目录 .env 中设置';
  } catch (e) {
    el.className = 'health bad';
    el.textContent = '无法连接后端：' + e.message;
  }
}

function renderAgents(reg) {
  const ul = $('#agent-list');
  ul.innerHTML = '';
  for (const a of reg.agents || []) {
    const li = document.createElement('li');
    li.dataset.botId = a.botId;
    if (a.botId === selectedBotId) li.classList.add('active');
    li.innerHTML = `
      <div class="agent-meta">
        <strong>${escapeHtml(a.name || a.botId)}</strong>
        <small>${escapeHtml(a.botId)}</small>
      </div>
      <button type="button" class="link" data-remove="${escapeHtml(a.botId)}">移除</button>
    `;
    li.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-remove]')) return;
      selectAgent(a.botId);
    });
    ul.appendChild(li);
  }

  ul.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.getAttribute('data-remove');
      if (!confirm(`从登记列表移除 ${id}？（不会删除本地 md 文件）`)) return;
      await api(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (selectedBotId === id) {
        selectedBotId = null;
        $('#prompt-body').value = '';
      }
      await loadAgents();
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadAgents() {
  const reg = await api('/api/agents');
  renderAgents(reg);
}

async function selectAgent(botId) {
  selectedBotId = botId;
  $('#prompt-status').textContent = '';
  renderAgents(await api('/api/agents'));
  const pr = await api(`/api/prompts/${encodeURIComponent(botId)}`);
  $('#prompt-body').value = pr.text || '';
}

$('#add-agent').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const botId = String(fd.get('botId') || '').trim();
  const name = String(fd.get('name') || '').trim();
  if (!botId) return;
  try {
    await api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ botId, name: name || undefined }),
    });
    ev.target.reset();
    await loadAgents();
    await selectAgent(botId);
  } catch (e) {
    alert(e.message);
  }
});

$('#save-prompt').addEventListener('click', async () => {
  if (!selectedBotId) {
    alert('请先选择一个智能体');
    return;
  }
  const st = $('#prompt-status');
  st.textContent = '保存中…';
  try {
    await api(`/api/prompts/${encodeURIComponent(selectedBotId)}`, {
      method: 'PUT',
      body: JSON.stringify({ text: $('#prompt-body').value }),
    });
    st.textContent = '已保存';
  } catch (e) {
    st.textContent = '失败：' + e.message;
  }
});

$('#send-debug').addEventListener('click', async () => {
  const botId = selectedBotId || prompt('请输入 bot_id');
  if (!botId) return;
  const message = $('#debug-msg').value.trim();
  if (!message) {
    alert('请输入消息');
    return;
  }
  const out = $('#debug-out');
  out.textContent = '请求中…';
  try {
    const data = await api('/api/debug/chat', {
      method: 'POST',
      body: JSON.stringify({ botId, message }),
    });
    out.textContent = JSON.stringify(
      {
        ok: data.ok,
        status: data.status,
        reply: data.reply,
        chatId: data.chatId,
        conversationId: data.conversationId,
        usage: data.usage,
        lastError: data.lastError,
      },
      null,
      2
    );
  } catch (e) {
    out.textContent =
      JSON.stringify({ error: e.message, detail: e.detail }, null, 2) ||
      String(e);
  }
});

refreshHealth();
loadAgents().catch((e) => {
  $('#health').className = 'health bad';
  $('#health').textContent = e.message;
});
