/**
 * The log viewer's single HTML page — a self-contained shell (dark, matching
 * the framework's other built-in pages) that fetches files/entries from the
 * plugin's own JSON API via plain `fetch()`. No build step, no framework
 * dependency (Vue/React/etc.) — this ships standalone in `@elyvel/log-viewer`.
 */
export function renderLogViewerPage(basePath: string): string {
  const api = JSON.stringify(basePath)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log Viewer</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e5e7eb; background: #0a0a0f; font-size: 14px;
  }
  aside {
    width: 260px; flex-shrink: 0; border-right: 1px solid rgba(255,255,255,0.08); overflow-y: auto;
    padding: 0.75rem;
  }
  aside h1 { font-size: 0.85rem; font-weight: 600; color: #fff; margin: 0.25rem 0.5rem 0.75rem; }
  .file {
    display: block; width: 100%; text-align: left; padding: 0.5rem 0.6rem; border-radius: 0.4rem; border: none;
    background: transparent; color: #9ca3af; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem;
    cursor: pointer; margin-bottom: 0.15rem;
  }
  .file:hover { background: rgba(255,255,255,0.04); }
  .file.active { background: rgba(99,102,241,0.15); color: #e5e7eb; }
  .file .size { display: block; color: #4b5563; font-size: 0.7rem; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .toolbar {
    display: flex; gap: 0.5rem; padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.08); align-items: center;
  }
  .toolbar input, .toolbar select {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb;
    border-radius: 0.4rem; padding: 0.4rem 0.6rem; font-size: 0.8rem;
  }
  .toolbar input[type="text"] { flex: 1; }
  .toolbar button {
    background: rgba(248,113,113,0.15); border: 1px solid rgba(248,113,113,0.3); color: #fca5a5;
    border-radius: 0.4rem; padding: 0.4rem 0.7rem; font-size: 0.78rem; cursor: pointer;
  }
  .entries { flex: 1; overflow-y: auto; padding: 0.5rem; }
  .entry { border-radius: 0.5rem; border: 1px solid rgba(255,255,255,0.06); margin-bottom: 0.4rem; overflow: hidden; }
  .entry-head {
    display: flex; gap: 0.6rem; align-items: baseline; padding: 0.5rem 0.75rem; cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem;
  }
  .entry-head:hover { background: rgba(255,255,255,0.02); }
  .lvl { font-weight: 700; width: 3.2rem; flex-shrink: 0; }
  .lvl.error { color: #f87171; }
  .lvl.warn { color: #fbbf24; }
  .lvl.info { color: #22d3ee; }
  .lvl.debug { color: #6b7280; }
  .time { color: #6b7280; flex-shrink: 0; }
  .msg { color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry-body {
    display: none; padding: 0.6rem 0.9rem 0.8rem; border-top: 1px solid rgba(255,255,255,0.06);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.76rem; white-space: pre-wrap;
    color: #9ca3af; background: rgba(255,255,255,0.015);
  }
  .entry.open .entry-body { display: block; }
  .empty { color: #6b7280; padding: 2rem; text-align: center; }
  .pager { display: flex; gap: 0.5rem; justify-content: center; padding: 0.6rem; border-top: 1px solid rgba(255,255,255,0.08); }
  .pager button {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb;
    border-radius: 0.4rem; padding: 0.3rem 0.6rem; font-size: 0.78rem; cursor: pointer;
  }
  .pager button:disabled { opacity: 0.4; cursor: default; }
  @media (prefers-color-scheme: light) {
    body { color: #1f2937; background: #f8fafc; }
    aside { border-color: rgba(0,0,0,0.08); }
    aside h1 { color: #0f172a; }
    .file { color: #4b5563; }
    .file.active { background: rgba(79,70,229,0.1); color: #111827; }
    .toolbar { border-color: rgba(0,0,0,0.08); }
    .toolbar input, .toolbar select { background: #fff; border-color: rgba(0,0,0,0.1); color: #1f2937; }
    .entry { border-color: rgba(0,0,0,0.06); }
    .entry-body { border-color: rgba(0,0,0,0.06); background: rgba(0,0,0,0.015); color: #4b5563; }
    .msg { color: #1f2937; }
  }
</style>
</head>
<body>
  <aside>
    <h1>Log files</h1>
    <div id="files"></div>
  </aside>
  <main>
    <div class="toolbar">
      <select id="level">
        <option value="">All levels</option>
        <option value="error">error</option>
        <option value="warn">warn</option>
        <option value="info">info</option>
        <option value="debug">debug</option>
      </select>
      <input id="q" type="text" placeholder="Search…">
      <button id="delete">Delete file</button>
    </div>
    <div class="entries" id="entries"></div>
    <div class="pager">
      <button id="prev">← Prev</button>
      <span id="pageInfo" style="align-self:center;color:#6b7280;font-size:0.78rem;"></span>
      <button id="next">Next →</button>
    </div>
  </main>
  <script>
    const API = ${api};
    let state = { file: null, level: '', q: '', page: 1, perPage: 50 };

    async function loadFiles() {
      const res = await fetch(API + '/api/files');
      const data = await res.json();
      const el = document.getElementById('files');
      el.textContent = '';
      for (const f of data.files || []) {
        const btn = document.createElement('button');
        btn.className = 'file' + (state.file === f.name ? ' active' : '');
        btn.appendChild(document.createTextNode(f.name));
        const size = document.createElement('span');
        size.className = 'size';
        size.textContent = (f.size / 1024).toFixed(1) + ' KB';
        btn.appendChild(size);
        btn.onclick = () => { state.file = f.name; state.page = 1; render(); loadFiles(); };
        el.appendChild(btn);
      }
      if (!state.file && data.files && data.files.length) {
        state.file = data.files[0].name;
        render();
      }
    }

    async function render() {
      if (!state.file) return;
      const params = new URLSearchParams({ level: state.level, q: state.q, page: state.page, perPage: state.perPage });
      const res = await fetch(API + '/api/files/' + encodeURIComponent(state.file) + '/entries?' + params);
      const data = await res.json();
      const el = document.getElementById('entries');
      el.textContent = '';
      if (!data.entries || data.entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No entries match.';
        el.appendChild(empty);
      }
      for (const e of data.entries || []) {
        const { time, level, name, message, _raw, ...context } = e;
        const div = document.createElement('div');
        div.className = 'entry';
        const head = document.createElement('div');
        head.className = 'entry-head';

        const lvl = document.createElement('span');
        lvl.className = 'lvl ' + (level || '');
        lvl.textContent = (level || '').toUpperCase();

        const timeEl = document.createElement('span');
        timeEl.className = 'time';
        timeEl.textContent = time || '';

        const msgEl = document.createElement('span');
        msgEl.className = 'msg';
        msgEl.textContent = (name ? '(' + name + ') ' : '') + (message || '');

        head.appendChild(lvl);
        head.appendChild(timeEl);
        head.appendChild(msgEl);
        head.onclick = () => div.classList.toggle('open');
        const body = document.createElement('div');
        body.className = 'entry-body';
        // Pretty-mode entries (FileTransport's pretty option) carry their
        // context/stack as one raw text block in _raw, since it may
        // contain real newlines and can't be safely re-parsed into fields.
        // JSON-mode entries have no _raw -- show the structured context instead.
        body.textContent = _raw !== undefined ? _raw : JSON.stringify(context, null, 2);
        div.appendChild(head);
        div.appendChild(body);
        el.appendChild(div);
      }
      const totalPages = Math.max(1, Math.ceil((data.total || 0) / state.perPage));
      document.getElementById('pageInfo').textContent = 'Page ' + state.page + ' / ' + totalPages + ' (' + data.total + ' entries)';
      document.getElementById('prev').disabled = state.page <= 1;
      document.getElementById('next').disabled = state.page >= totalPages;
    }

    document.getElementById('level').onchange = e => { state.level = e.target.value; state.page = 1; render(); };
    document.getElementById('q').oninput = e => { state.q = e.target.value; state.page = 1; render(); };
    document.getElementById('prev').onclick = () => { if (state.page > 1) { state.page--; render(); } };
    document.getElementById('next').onclick = () => { state.page++; render(); };
    document.getElementById('delete').onclick = async () => {
      if (!state.file || !confirm('Delete ' + state.file + '? This cannot be undone.')) return;
      await fetch(API + '/api/files/' + encodeURIComponent(state.file), { method: 'DELETE' });
      state.file = null;
      await loadFiles();
    };

    loadFiles();
  </script>
</body>
</html>`
}
