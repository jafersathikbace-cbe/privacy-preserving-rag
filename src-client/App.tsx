import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUp, Check, CheckCircle2, ChevronDown, Clock3,
  Copy, FileSearch, FileText, FolderOpen, HelpCircle, History, LockKeyhole,
  Menu, MessageSquare, MoreHorizontal, Plus, RefreshCw, Search, Send, ShieldCheck,
  Sparkles, Trash2, UploadCloud, X, Zap
} from 'lucide-react';

interface Citation { id: number; source: string; page: string; chunk: string; }
interface Message { role: 'user' | 'assistant'; content: string; citations?: Citation[]; verification?: string; queryId?: string; }
interface Session { id: string; title: string; timestamp: string; last_message: string; }
interface Stats { ready: boolean; indexing: boolean; documents: number; indexedDocuments: number; chunks: number; }

const STAGES = ['Reading documents', 'Building semantic index', 'Applying privacy transform', 'Verifying integrity'];

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>({ ready: false, indexing: false, documents: 0, indexedDocuments: 0, chunks: 0 });
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState(0);
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [expandedCitation, setExpandedCitation] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const notify = (text: string) => { setToast(text); window.setTimeout(() => setToast(null), 3200); };
  const sources = useMemo(() => ['all', ...files], [files]);

  const refresh = async () => {
    try {
      const [f, s, c] = await Promise.all([fetch('/files'), fetch('/stats'), fetch('/conversations')]);
      if (f.ok) setFiles((await f.json()).files || []);
      if (s.ok) setStats(await s.json());
      if (c.ok) setSessions(await c.json());
    } catch { /* transient network state */ }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const openSession = async (id: string) => {
    const res = await fetch(`/conversation/${encodeURIComponent(id)}`);
    if (!res.ok) return notify('Could not open session');
    const data = await res.json();
    setCurrentSession(data.id);
    setMessages(data.messages || []);
    setSidebar(false);
  };

  const newSession = async () => {
    const res = await fetch('/new_conversation', { method: 'POST' });
    if (!res.ok) return notify('Could not create session');
    const data = await res.json();
    setCurrentSession(data.id); setMessages([]); await refresh(); setSidebar(false);
  };

  const removeSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/delete_conversation/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) { if (currentSession === id) { setCurrentSession(null); setMessages([]); } await refresh(); notify('Session deleted'); }
  };

  const upload = async (input: FileList | File[]) => {
    const selected = Array.from(input || []);
    if (!selected.length) return;
    const max = 25 * 1024 * 1024;
    const bad = selected.find((f) => f.size > max);
    if (bad) return notify(`${bad.name} is larger than the 25 MB limit.`);
    setUploading(true); setUploadStage(0);
    const timer = window.setInterval(() => setUploadStage((s) => Math.min(3, s + 1)), 900);
    const form = new FormData(); selected.forEach((f) => form.append('files', f));
    try {
      const res = await fetch('/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      setUploadStage(3); await refresh(); notify(data.message || 'Documents indexed');
    } catch (err: any) { notify(err.message || 'Upload failed'); }
    finally { window.clearInterval(timer); window.setTimeout(() => setUploading(false), 500); if (fileRef.current) fileRef.current.value = ''; }
  };

  const removeFile = async (file: string) => {
    if (!window.confirm(`Remove “${file}” from the private vault and rebuild the index?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/delete_file/${encodeURIComponent(file)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Delete failed');
      await refresh(); notify(`Removed ${file}`);
    } catch (err: any) { notify(err.message || 'Could not remove document'); }
    finally { setBusy(false); }
  };

  const send = async () => {
    const text = query.trim();
    if (!text || busy || !stats.ready) return;
    setQuery('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    const assistantIndex = messages.length + 1;
    setMessages((m) => [...m, { role: 'assistant', content: '', verification: 'pending', citations: [] }]);
    try {
      const res = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, conversation_id: currentSession, source: sourceFilter }) });
      if (!res.ok) throw new Error((await res.text()) || 'Request failed');
      const reader = res.body?.getReader(); if (!reader) throw new Error('Streaming response unavailable');
      const decoder = new TextDecoder(); let buffer = ''; let answer = ''; let citations: Citation[] = []; let verification = 'pending'; let queryId = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'citations') citations = event.citations || [];
            if (event.type === 'answer') { answer = event.content || ''; verification = event.verification || verification; }
            if (event.type === 'done') { verification = event.verification || verification; queryId = event.query_id || queryId; }
            setMessages((prev) => { const next = [...prev]; next[assistantIndex] = { role: 'assistant', content: answer, citations, verification, queryId }; return next; });
          } catch { /* partial chunk */ }
        }
      }
      await refresh();
    } catch (err: any) {
      setMessages((prev) => { const next = [...prev]; next[assistantIndex] = { role: 'assistant', content: err.message || 'The request failed.', verification: 'refused' }; return next; });
    } finally { setBusy(false); }
  };

  const feedback = async (queryId: string | undefined, rating: number) => {
    if (!queryId) return;
    const res = await fetch('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query_id: queryId, rating }) });
    if (res.ok) notify(rating ? 'Feedback recorded' : 'Thanks — we will use that signal');
  };

  const copy = async (text: string) => { await navigator.clipboard?.writeText(text); notify('Answer copied'); };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={20} /></div>
          <div><div className="brand-name">NEXUS</div><div className="brand-sub">PRIVATE RAG PLATFORM</div></div>
          <button className="icon-button mobile-only" onClick={() => setSidebar(false)}><X size={18} /></button>
        </div>

        <button className="new-session" onClick={newSession}><Plus size={16} /> New analysis</button>

        <div className="sidebar-section session-section">
          <div className="section-label"><span>Workspace</span><span>{sessions.length}</span></div>
          <div className="session-list">
            {sessions.length === 0 ? <div className="empty-small">Your analysis history will appear here.</div> : sessions.map((s) => (
              <div key={s.id} className={`session-row ${currentSession === s.id ? 'active' : ''}`} onClick={() => openSession(s.id)}>
                <MessageSquare size={14} />
                <div className="session-copy"><div>{s.title}</div><span>{s.last_message}</span></div>
                <button className="row-action" onClick={(e) => removeSession(s.id, e)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="vault">
          <div className="vault-heading"><div><div className="section-title"><FolderOpen size={15} /> Document vault</div><div className="muted">Private indexed sources</div></div><span className="count-pill">{files.length}</span></div>
          <div className="source-filter" title="Choose which documents the next question can search">
            <Search size={13} />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">Search all documents</option>
              {files.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="file-list">
            {(sourceFilter === 'all' ? files : files.filter((f) => f === sourceFilter)).map((file) => (
              <div className="file-row" key={file} title={file}>
                <FileText size={14} /><span>{file}</span><button onClick={() => removeFile(file)} disabled={busy} title="Remove document"><Trash2 size={13} /></button>
              </div>
            ))}
            {!files.length && <div className="empty-small">No documents yet. Add your first source below.</div>}
          </div>
          <button className="upload-button" onClick={() => fileRef.current?.click()} disabled={busy}><UploadCloud size={16} /><span>Add documents</span></button>
          <input ref={fileRef} hidden type="file" multiple accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.bmp,.tiff" onChange={(e) => e.target.files && upload(e.target.files)} />
          <div className="vault-status"><span><i className="status-dot" /> Integrity verified</span><span>{stats.chunks.toLocaleString()} chunks</span></div>
        </div>
      </aside>

      {sidebar && <div className="mobile-overlay" onClick={() => setSidebar(false)} />}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-only" onClick={() => setSidebar(true)}><Menu size={20} /></button><div><div className="eyebrow">DOCUMENT INTELLIGENCE</div><div className="top-title">Private knowledge workspace</div></div></div>
          <div className="top-actions"><div className="system-status"><i className="status-dot" /> System operational</div><button className="icon-button" onClick={refresh} title="Refresh"><RefreshCw size={17} /></button></div>
        </header>

        <section className="workspace">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-kicker"><Sparkles size={14} /> VERIFIED DOCUMENT AI</div>
              <h1>Ask your knowledge base.<br /><span>Get answers you can trace.</span></h1>
              <p className="welcome-copy">Search across every uploaded document, combine semantic and lexical retrieval, verify evidence with SHA-256 Merkle proofs, and refuse unsupported answers.</p>
              <div className="metric-grid">
                <Metric icon={<FileSearch size={17} />} label="Indexed sources" value={stats.documents} />
                <Metric icon={<Zap size={17} />} label="Searchable chunks" value={stats.chunks.toLocaleString()} />
                <Metric icon={<LockKeyhole size={17} />} label="Vector protection" value="Masked" />
                <Metric icon={<ShieldCheck size={17} />} label="Answer policy" value="Fail-closed" />
              </div>
              <div className="capability-grid">
                <Capability icon={<Search />} title="Hybrid retrieval" text="Semantic similarity + exact lexical signals, searched across the full corpus." />
                <Capability icon={<ShieldCheck />} title="Verified evidence" text="Only chunks that pass their cryptographic integrity proof reach generation." />
                <Capability icon={<History />} title="Context-aware" text="Conversation history can resolve references without becoming evidence." />
              </div>
              {!files.length && <div className="empty-callout"><UploadCloud size={18} /><div><strong>Start with a document</strong><span>PDF, DOCX, TXT and common images up to 25 MB.</span></div><button onClick={() => fileRef.current?.click()}>Upload</button></div>}
            </div>
          ) : (
            <div className="chat-area">
              <div className="chat-header"><div><div className="eyebrow">ANALYSIS SESSION</div><h2>{sessions.find((s) => s.id === currentSession)?.title || 'Current analysis'}</h2></div><div className="grounding-badge"><CheckCircle2 size={14} /> Grounded mode</div></div>
              <div className="messages">
                {messages.map((m, i) => <MessageCard key={i} message={m} onCopy={copy} onFeedback={feedback} expandedCitation={expandedCitation} setExpandedCitation={setExpandedCitation} />)}
                {busy && <div className="typing"><div className="assistant-avatar"><ShieldCheck size={16} /></div><div className="typing-card"><span /><span /><span /> Searching, verifying and grounding…</div></div>}
                <div ref={endRef} />
              </div>
            </div>
          )}
        </section>

        <div className="composer-wrap">
          <div className="composer">
            <div className="composer-meta"><span><ShieldCheck size={12} /> Answers restricted to verified documents</span><span>{files.length} sources</span></div>
            <div className="composer-row">
              <textarea ref={textareaRef} value={query} disabled={!stats.ready || busy} placeholder={stats.ready ? 'Ask anything about your uploaded documents…' : 'Upload a document to start asking questions…'} rows={1} onChange={(e) => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="send-button" onClick={send} disabled={!query.trim() || busy || !stats.ready} title="Send question"><ArrowUp size={18} /></button>
            </div>
            <div className="composer-hint"><span>Enter to send</span><span>Shift + Enter for a new line</span><span className="desktop-only">No web search · No unsupported claims</span></div>
          </div>
        </div>
      </main>

      {uploading && <div className="modal-backdrop"><div className="index-modal"><div className="modal-icon"><Activity size={20} /></div><div className="eyebrow">SECURE INDEXING</div><h3>Preparing your knowledge base</h3><p>Documents are being extracted, embedded, privacy-transformed and integrity-verified.</p><div className="progress-track"><div style={{ width: `${((uploadStage + 1) / 4) * 100}%` }} /></div><div className="stage-list">{STAGES.map((stage, i) => <div className={i <= uploadStage ? 'done' : ''} key={stage}><span>{i < uploadStage ? <Check size={12} /> : i === uploadStage ? <Activity size={12} /> : i + 1}</span>{stage}</div>)}</div></div></div>}
      {toast && <div className="toast"><CheckCircle2 size={15} /> {toast}</div>}
    </div>
  );
}

