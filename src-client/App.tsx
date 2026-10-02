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

