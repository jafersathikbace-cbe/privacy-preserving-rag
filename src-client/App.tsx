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

