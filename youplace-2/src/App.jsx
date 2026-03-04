import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import * as mammoth from "mammoth";

// Funkce pro parsovani ruznych typu souboru
async function parseFile(file) {
  const name = file.name.toLowerCase();
  
  // Excel soubory
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          let result = '';
          workbook.SheetNames.forEach(sheetName => {
            result += `\n=== LIST: ${sheetName} ===\n`;
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            result += csv;
          });
          resolve({ type: 'text', content: result });
        } catch (err) {
          resolve({ type: 'error', content: 'Chyba pri cteni Excel souboru: ' + err.message });
        }
      };
      reader.onerror = () => resolve({ type: 'error', content: 'Chyba pri nacitani souboru' });
      reader.readAsArrayBuffer(file);
    });
  }
  
  // Word soubory
  if (name.endsWith('.docx')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
          resolve({ type: 'text', content: result.value });
        } catch (err) {
          resolve({ type: 'error', content: 'Chyba pri cteni Word souboru: ' + err.message });
        }
      };
      reader.onerror = () => resolve({ type: 'error', content: 'Chyba pri nacitani souboru' });
      reader.readAsArrayBuffer(file);
    });
  }
  
  // Textove soubory
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json') || name.endsWith('.csv')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ type: 'text', content: e.target.result });
      reader.onerror = () => resolve({ type: 'error', content: 'Chyba pri nacitani souboru' });
      reader.readAsText(file);
    });
  }
  
  // PDF - base64 pro AI (Claude umi cist PDF primo)
  if (name.endsWith('.pdf')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ type: 'pdf', content: e.target.result });
      reader.onerror = () => resolve({ type: 'error', content: 'Chyba pri nacitani PDF' });
      reader.readAsDataURL(file);
    });
  }
  
  // Obrazky - base64
  if (name.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ type: 'image', content: e.target.result });
      reader.onerror = () => resolve({ type: 'error', content: 'Chyba pri nacitani obrazku' });
      reader.readAsDataURL(file);
    });
  }
  
  // Ostatni - pokus o text
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve({ type: 'text', content: e.target.result });
    reader.onerror = () => resolve({ type: 'binary', content: null });
    reader.readAsText(file);
  });
}

// Prompty jsou na backendu v lib/system-prompts.js
// App.jsx posila pouze roleId -- zadne prompty zde

const ROLES = [
  { id: "financak", title: "Financni reditel", subtitle: "& Danovy poradce", desc: "Cashflow, dane, DPH, rozpocty, optimalizace", initials: "FR" },
  { id: "asistentka", title: "Asistentka", subtitle: "Gmail & Kalendar", desc: "Emaily, schuzky, organizace, dokumenty", initials: "AS" },
  { id: "inovator", title: "Business analytik", subtitle: "Strategie & Rozvoj", desc: "Analyza, automatizace, dotace, nove prilezitosti", initials: "BA" },
  { id: "zadavatel", title: "Programator", subtitle: "Claude Code & Dev", desc: "Pripravi presne zadani pro terminal", initials: "PR" },
  { id: "stavbar", title: "Stavebni specialista", subtitle: "Normy & Materialy", desc: "Postupy, ETICS, panelove domy, rozpocty", initials: "ST" },
];

const PORADA = { id: "porada", title: "Porada", subtitle: "Vsichni poradci", desc: "Tymova diskuze -- vsech 5 roli najednou", initials: "PS" };

const font = "'Poppins', sans-serif";

// callClaude -- posila roleId na backend, prompt se tahne ze system-prompts.js
async function callClaude(messages, roleId, poradaMembers = null, mediaAttachments = []) {
  try {
    const formattedMessages = messages.map((m, idx) => {
      if (m.role === "user") {
        if (idx === messages.length - 1 && mediaAttachments.length > 0) {
          const content = [];
          for (const media of mediaAttachments) {
            if (media.type === 'image') {
              const base64Data = media.data.split(',')[1];
              const mediaType = media.data.split(';')[0].split(':')[1];
              content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } });
            } else if (media.type === 'pdf') {
              const base64Data = media.data.split(',')[1];
              content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } });
            }
          }
          content.push({ type: "text", text: m.text });
          return { role: "user", content };
        }
        return { role: "user", content: m.text };
      }
      return { role: "assistant", content: m.text };
    });

    // Posila roleId misto system promptu -- backend si prompt tahne sam
    const body = {
      roleId,
      poradaMembers: poradaMembers || undefined,
      messages: formattedMessages
    };

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) {
      return { text: "Chyba: " + (data.error.message || data.error), internalComms: [], actionResults: [] };
    }
    const parts = [];
    for (const block of (data.content || [])) {
      if (block.type === "text" && block.text) parts.push(block.text);
    }
    const text = parts.filter(Boolean).join("\n\n") || "Chyba pri zpracovani odpovedi.";
    return { text, internalComms: data.internalComms || [], actionResults: data.actionResults || [] };
  } catch (err) {
    return { text: "Chyba spojeni s API: " + err.message, internalComms: [], actionResults: [] };
  }
}


// Storage functions - using localStorage for Vercel deployment
const SP = "yp-ai-";
async function sGet(key) { 
  try { 
    const val = localStorage.getItem(SP + key); 
    return val ? JSON.parse(val) : null; 
  } catch { 
    return null; 
  } 
}
async function sSet(key, val) { 
  try { 
    localStorage.setItem(SP + key, JSON.stringify(val)); 
  } catch(e) { 
    console.error(e); 
  } 
}
async function sDel(key) { 
  try { 
    localStorage.removeItem(SP + key); 
  } catch(e) {} 
}
async function loadDebateList(roleId) { return await sGet("debates-" + roleId) || []; }
async function saveDebateList(roleId, list) { await sSet("debates-" + roleId, list); }
async function loadDebate(debateId) { return await sGet("debate-" + debateId) || null; }
async function saveDebate(debate) { await sSet("debate-" + debate.id, debate); }

export default function AIAdvisoryBoard() {
  const [screen, setScreen] = useState("home");
  const [activeRole, setActiveRole] = useState(null);
  const [debates, setDebates] = useState([]);
  const [activeDebate, setActiveDebate] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("pamet");
  const [dragOver, setDragOver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [askColleague, setAskColleague] = useState(null);
  const [poradaMembers, setPoradaMembers] = useState(["financak", "asistentka", "inovator", "zadavatel", "stavbar"]);
  const [files, setFiles] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [generatedFiles, setGeneratedFiles] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [internalComms, setInternalComms] = useState([]);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Nacti inbox pri startu
  const loadInbox = async () => {
    try {
      const res = await fetch("/api/inbox");
      const data = await res.json();
      if (data.items) setInbox(data.items);
    } catch (e) { console.error("Inbox load error:", e); }
  };

  useEffect(() => { loadInbox(); }, []);

  const resolveInboxItem = async (itemId, resolution) => {
    try {
      await fetch("/api/inbox", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, resolution, status: "resolved" })
      });
      loadInbox();
    } catch (e) { console.error("Resolve error:", e); }
  };

  const ROLE_MAP = { financak: "FR", asistentka: "AS", inovator: "BA", zadavatel: "PR", stavbar: "ST" };
  const DEPT_TO_ROLE = { finance: "financak", administration: "asistentka", ceo: "inovator", projects: "zadavatel", crm: "stavbar" };

  const FILE_CATEGORIES = [
    { id: "technicke-listy", name: "Technicke listy", desc: "TL vyrobcu, navody k aplikaci", icon: "TL", exts: [] },
    { id: "normy", name: "Normy & Predpisy", desc: "CSN, vyhlasky, zakony", icon: "NP", exts: [] },
    { id: "rozpocty", name: "Rozpocty & Kalkulace", desc: "Cenove nabidky, vykazy vymer", icon: "RK", exts: [".xlsx", ".xls", ".csv"] },
    { id: "smlouvy", name: "Smlouvy & Dokumenty", desc: "SoD, objednavky, fakturace", icon: "SD", exts: [".docx", ".doc"] },
    { id: "projekty", name: "Projektova dokumentace", desc: "Vykresy, PD, fotodokumentace", icon: "PD", exts: [".dwg", ".dxf"] },
    { id: "financni", name: "Finance & Dane", desc: "Danove doklady, ucetnictvi", icon: "FD", exts: [] },
    { id: "obrazky", name: "Obrazky & Foto", desc: "Fotky staveb, vizualizace, plany", icon: "OF", exts: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"] },
    { id: "ostatni", name: "Ostatni", desc: "Nezarazene soubory", icon: "OS", exts: [] },
  ];

  const categorizeFile = (filename) => {
    const ext = "." + filename.split(".").pop().toLowerCase();
    for (const cat of FILE_CATEGORIES) {
      if (cat.exts.length > 0 && cat.exts.includes(ext)) return cat.id;
    }
    if (ext === ".pdf") {
      const lower = filename.toLowerCase();
      if (lower.includes("tl") || lower.includes("technick")) return "technicke-listy";
      if (lower.includes("csn") || lower.includes("norma") || lower.includes("vyhlask")) return "normy";
      if (lower.includes("smlouv") || lower.includes("sod") || lower.includes("faktur")) return "smlouvy";
      if (lower.includes("rozpoc") || lower.includes("nabid") || lower.includes("vykaz")) return "rozpocty";
      return "ostatni";
    }
    return "ostatni";
  };

  useEffect(() => { sGet("files-list").then(f => { if (f) setFiles(f); }); }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (activeRole) { loadDebateList(activeRole).then(d => setDebates(d)); } }, [activeRole]);

  const openRole = async (id) => {
    setActiveRole(id); setScreen("chat");
    const dl = await loadDebateList(id); setDebates(dl);
    if (dl.length > 0) { const d = await loadDebate(dl[0].id); setActiveDebate(d); setMessages(d?.messages || []); }
    else { newDebate(id); }
  };
  const newDebate = (roleId) => {
    const rid = roleId || activeRole;
    const d = { id: Date.now().toString(), roleId: rid, title: "Nova debata", createdAt: new Date().toISOString(), messages: [], summary: null };
    setActiveDebate(d); setMessages([]);
  };
  const openDebate = async (debateInfo) => { const d = await loadDebate(debateInfo.id); if (d) { setActiveDebate(d); setMessages(d.messages || []); } };
  const goHome = () => { setScreen("home"); setActiveRole(null); setMessages([]); setActiveDebate(null); };
  const togglePoradaMember = (id) => {
    setPoradaMembers(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const buildFilesContext = () => {
    if (files.length === 0) return "";
    const grouped = {};
    FILE_CATEGORIES.forEach(c => {
      const catFiles = files.filter(f => f.category === c.id);
      if (catFiles.length > 0) grouped[c.name] = catFiles.map(f => f.name);
    });
    if (Object.keys(grouped).length === 0) return "";
    let ctx = "\n\nDOSTUPNE FIREMNI SOUBORY (znalostni baze):\n";
    for (const [cat, names] of Object.entries(grouped)) {
      ctx += `${cat}: ${names.join(", ")}\n`;
    }
    ctx += "Pokud je pro tvou odpoved relevantni nektery soubor, odkazuj na nej. Mas k nim pristup.";
    return ctx;
  };

  const handleChatFileDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer?.files || []);
    const newAttachments = [];
    for (const f of droppedFiles) {
      const parsed = await parseFile(f);
      newAttachments.push({ 
        name: f.name, 
        content: parsed.content, 
        type: f.type,
        parsedType: parsed.type 
      });
    }
    setChatAttachments(prev => [...prev, ...newAttachments]);
  };

  const handleFileInputChange = async (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    const newAttachments = [];
    for (const f of selectedFiles) {
      const parsed = await parseFile(f);
      newAttachments.push({ 
        name: f.name, 
        content: parsed.content, 
        type: f.type,
        parsedType: parsed.type 
      });
    }
    setChatAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const sendMessage = async () => {
    if ((!inputValue.trim() && chatAttachments.length === 0) || loading) return;
    let userText = inputValue.trim();
    
    // Detekuj delegaci primo z user zpravy
    const roleMap = { AS: "asistentka", FR: "financak", BA: "inovator", PR: "zadavatel", ST: "stavbar" };
    const roleNames = { financak: "Financni reditel", asistentka: "Asistentka", inovator: "Business analytik", zadavatel: "Programator", stavbar: "Stavebni specialista" };
    
    const userDelegationPatterns = [
      { pattern: /[Pp][řr]edej\s+to\s+[Aa]sistentce/i, role: "asistentka" },
      { pattern: /[Pp][řr]edej\s+[Aa]sistentce/i, role: "asistentka" },
      { pattern: /[Aa][ťt]\s+to\s+(ud[ěe]l[áa]|vypracuje|zpracuje)\s+[Aa]sistentka/i, role: "asistentka" },
      { pattern: /[Aa][ťt]\s+to\s+[Aa]sistentka/i, role: "asistentka" },
      { pattern: /[Pp][řr]edej\s+to\s+[Ff]inan[čc][áa]kovi/i, role: "financak" },
      { pattern: /[Pp][řr]edej\s+to\s+[Ss]tavba[řr]ovi/i, role: "stavbar" },
      { pattern: /[Pp][řr]edej\s+to\s+[Pp]rogram[áa]torovi/i, role: "zadavatel" },
      { pattern: /[Pp][řr]edej\s+to\s+[Aa]nalytikovi/i, role: "inovator" },
      { pattern: /[Řr]ekni\s+[Aa]sistentce/i, role: "asistentka" },
      { pattern: /[Řr]ekni\s+[Ff]inan[čc][áa]kovi/i, role: "financak" },
      { pattern: /[Řr]ekni\s+[Ss]tavba[řr]ovi/i, role: "stavbar" },
    ];
    
    let directDelegation = null;
    for (const dp of userDelegationPatterns) {
      if (dp.pattern.test(userText)) {
        directDelegation = dp.role;
        break;
      }
    }
    
    // Zpracuj prilohy podle typu
    const textAttachments = [];
    const mediaAttachments = [];
    
    for (const a of chatAttachments) {
      if (a.parsedType === 'text' && a.content) {
        textAttachments.push(`\n\n=== SOUBOR: ${a.name} ===\n${a.content}`);
      } else if (a.parsedType === 'image' && a.content) {
        mediaAttachments.push({ type: 'image', name: a.name, data: a.content });
      } else if (a.parsedType === 'pdf' && a.content) {
        mediaAttachments.push({ type: 'pdf', name: a.name, data: a.content });
      } else {
        textAttachments.push(`\n\n[Priloha: ${a.name} - nepodporovany format]`);
      }
    }
    
    if (textAttachments.length > 0) {
      userText += textAttachments.join('');
    }
    const userMsg = { role: "user", text: userText, attachments: chatAttachments.length > 0 ? chatAttachments.map(a => a.name) : undefined };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs); setInputValue(""); setChatAttachments([]); setLoading(true);
    
    // Pokud user chce primo delegovat, udelej to
    if (directDelegation && directDelegation !== activeRole) {
      const currentRoleName = roleNames[activeRole] || "Kolega";

      // Predej kontext z predchozich zprav
      const contextSummary = messages.slice(-4).map(m => m.text).join("\n\n");
      const delegationMsg = [{ role: "user", text: `[Ukol od ${currentRoleName}]\n\nKontext z predchozi konverzace:\n${contextSummary}\n\nNovy ukol: ${userText}` }];
      
      const colleagueResult = await callClaude(delegationMsg, directDelegation, null, []);
      const aiText = `**Predano ${roleNames[directDelegation]}:**\n\n${colleagueResult.text}`;
      
      // Uloz vlakno kolegovi
      const colleagueDebateId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      const colleagueDebate = {
        id: colleagueDebateId,
        title: `Ukol od ${currentRoleName}: ${userText.substring(0, 40)}...`,
        createdAt: new Date().toISOString(),
        messages: [
          { role: "user", text: `[Ukol od ${currentRoleName}] ${userText}` },
          { role: "ai", text: colleagueResult.text }
        ]
      };
      await saveDebate(colleagueDebate);
      let colleagueDebates = await loadDebateList(directDelegation);
      colleagueDebates.unshift({ id: colleagueDebateId, title: colleagueDebate.title, createdAt: colleagueDebate.createdAt });
      await saveDebateList(directDelegation, colleagueDebates);
      
      const aiMsg = { role: "ai", text: aiText };
      const finalMsgs = [...newMsgs, aiMsg]; setMessages(finalMsgs);
      let title = activeDebate?.title || "Nova debata";
      if (title === "Nova debata" && finalMsgs.length >= 2) { title = finalMsgs[0].text.substring(0, 50) + (finalMsgs[0].text.length > 50 ? "..." : ""); }
      const updatedDebate = { ...activeDebate, messages: finalMsgs, title };
      setActiveDebate(updatedDebate); await saveDebate(updatedDebate);
      let dl = await loadDebateList(activeRole);
      const idx = dl.findIndex(d => d.id === updatedDebate.id);
      const listItem = { id: updatedDebate.id, title, createdAt: updatedDebate.createdAt };
      if (idx >= 0) { dl[idx] = listItem; } else { dl.unshift(listItem); }
      await saveDebateList(activeRole, dl); setDebates(dl); setLoading(false);
      return;
    }
    
    // Backend si tahne prompt sam podle roleId
    const aiResult = await callClaude(newMsgs, activeRole, activeRole === "porada" ? poradaMembers : null, mediaAttachments);
    let aiText = aiResult.text;
    if (aiResult.internalComms && aiResult.internalComms.length > 0) {
      setInternalComms(prev => [...prev, ...aiResult.internalComms]);
    }
    if (aiResult.actionResults && aiResult.actionResults.length > 0) {
      loadInbox(); // Refresh inbox pokud jsou nove akce
    }
    
    // Preved prirozene fraze na delegacni tagy
    const naturalDelegations = [
      { pattern: /[Pp][řr]ed[áa]v[áa]m\s+[úu]kol\s+[Pp][řr][íi]mo\s+[Aa]sistentce[:\s]*/gi, replace: "[DELEGOVAT: AS] " },
      { pattern: /[Pp][řr]ed[áa]v[áa]m\s+[Pp][řr][íi]mo\s+[Aa]sistentce[:\s]*/gi, replace: "[DELEGOVAT: AS] " },
      { pattern: /[Pp][řr]ed[áa]v[áa]m\s+[Aa]sistentce[:\s]*/gi, replace: "[DELEGOVAT: AS] " },
      { pattern: /[Pp][řr]ed[áa]v[áa]m\s+[Ff]inan[čc][áa]kovi[:\s]*/gi, replace: "[DELEGOVAT: FR] " },
      { pattern: /[Pp][řr]ed[áa]v[áa]m\s+[Ss]tavba[řr]ovi[:\s]*/gi, replace: "[DELEGOVAT: ST] " },
      { pattern: /[Pp][řr]ed[áa]v[áa]m\s+[Pp]rogram[áa]torovi[:\s]*/gi, replace: "[DELEGOVAT: PR] " },
      { pattern: /[Pp][řr]ed[áa]v[áa]m\s+[Aa]nalytikovi[:\s]*/gi, replace: "[DELEGOVAT: BA] " },
      { pattern: /@[Aa]sistentka[:\s\-]*/gi, replace: "[DELEGOVAT: AS] " },
      { pattern: /@[Ff]inan[čc][áa]k[:\s\-]*/gi, replace: "[DELEGOVAT: FR] " },
      { pattern: /@[Ss]tavba[řr][:\s\-]*/gi, replace: "[DELEGOVAT: ST] " },
      { pattern: /@[Pp]rogram[áa]tor[:\s\-]*/gi, replace: "[DELEGOVAT: PR] " },
      { pattern: /@[Aa]nalytik[:\s\-]*/gi, replace: "[DELEGOVAT: BA] " },
      { pattern: /[Aa]sistentce\s+k\s+(okam[žz]it[ée]mu\s+)?vypracov[áa]n[íi][:\s]*/gi, replace: "[DELEGOVAT: AS] " },
      { pattern: /\*\*PRO ASISTENTKU[^*]*\*\*[:\s]*/gi, replace: "[DELEGOVAT: AS] " },
      { pattern: /\*\*[ÚU]KOL PRO ASISTENTKU[^*]*\*\*[:\s]*/gi, replace: "[DELEGOVAT: AS] " },
      { pattern: /[Aa]sistentko,\s*/gi, replace: "[DELEGOVAT: AS] " },
    ];
    for (const nd of naturalDelegations) {
      aiText = aiText.replace(nd.pattern, nd.replace);
    }
    
    // Zpracuj delegace - automaticky predej kolegum (roleMap a roleNames uz jsou definovane vyse)
    const currentRoleName = roleNames[activeRole] || "Kolega";
    const delegateRegex = /\[DELEGOVAT:\s*(FR|AS|BA|PR|ST)\]\s*(.+?)(?=\[DELEGOVAT:|$)/gs;
    let match;
    const delegations = [];
    while ((match = delegateRegex.exec(aiText)) !== null) {
      delegations.push({ role: roleMap[match[1]], task: match[2].trim() });
    }
    
    // Proved delegace a uloz vlakna kolegum
    if (delegations.length > 0) {
      for (const del of delegations) {
        const colleagueMsg = [{ role: "user", text: `[Ukol od ${currentRoleName}] ${del.task}` }];
        const colleagueResult = await callClaude(colleagueMsg, del.role, null, []);
        aiText += `\n\n---\n**${roleNames[del.role]} odpovida:**\n${colleagueResult.text}`;
        
        // Uloz vlakno kolegovi
        const colleagueDebateId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        const colleagueDebate = {
          id: colleagueDebateId,
          title: `Ukol od ${currentRoleName}: ${del.task.substring(0, 40)}...`,
          createdAt: new Date().toISOString(),
          messages: [
            { role: "user", text: `[Ukol od ${currentRoleName}] ${del.task}` },
            { role: "ai", text: colleagueResult.text }
          ]
        };
        await saveDebate(colleagueDebate);
        let colleagueDebates = await loadDebateList(del.role);
        colleagueDebates.unshift({ id: colleagueDebateId, title: colleagueDebate.title, createdAt: colleagueDebate.createdAt });
        await saveDebateList(del.role, colleagueDebates);
      }
      // Odstran delegacni tagy z puvodniho textu
      aiText = aiText.replace(delegateRegex, '');
    }
    
    // Zpracuj generovane soubory
    const fileRegex = /\[SOUBOR:\s*([^\]]+)\]([\s\S]*?)\[\/SOUBOR\]/g;
    let fileMatch;
    const newFiles = [];
    while ((fileMatch = fileRegex.exec(aiText)) !== null) {
      const fileName = fileMatch[1].trim();
      const fileContent = fileMatch[2].trim();
      newFiles.push({ name: fileName, content: fileContent, createdAt: new Date().toISOString() });
    }
    if (newFiles.length > 0) {
      setGeneratedFiles(prev => [...prev, ...newFiles]);
      // Nahrad tagy odkazy na stazeni
      aiText = aiText.replace(fileRegex, (match, name) => `**Soubor vytvoren: ${name.trim()}** (viz tlacitko Stahnout nize)`);
    }
    
    const aiMsg = { role: "ai", text: aiText, files: newFiles.length > 0 ? newFiles : undefined };
    const finalMsgs = [...newMsgs, aiMsg]; setMessages(finalMsgs);
    let title = activeDebate?.title || "Nova debata";
    if (title === "Nova debata" && finalMsgs.length >= 2) { title = finalMsgs[0].text.substring(0, 50) + (finalMsgs[0].text.length > 50 ? "..." : ""); }
    const updatedDebate = { ...activeDebate, messages: finalMsgs, title };
    setActiveDebate(updatedDebate); await saveDebate(updatedDebate);
    let dl = await loadDebateList(activeRole);
    const idx = dl.findIndex(d => d.id === updatedDebate.id);
    const listItem = { id: updatedDebate.id, title, createdAt: updatedDebate.createdAt };
    if (idx >= 0) { dl[idx] = listItem; } else { dl.unshift(listItem); }
    await saveDebateList(activeRole, dl); setDebates(dl); setLoading(false);
  };
  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const askColleagueFn = async (colleagueRoleId, question) => {
    if (!question.trim() || loading) return;
    setAskColleague(null);
    const currentRoleObj = ROLES.find(r => r.id === activeRole);
    const colleagueObj = ROLES.find(r => r.id === colleagueRoleId);
    const tag = `[Dotaz od ${currentRoleObj?.title || "kolegy"}]`;
    const userMsg = { role: "user", text: `Zeptat se ${colleagueObj?.title}: ${question}` };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs); setLoading(true);
    const contextMsg = [{ role: "user", text: `${tag} ${question}` }];
    const aiResult = await callClaude(contextMsg, colleagueRoleId, null, []);
    const aiMsg = { role: "ai", text: `**${colleagueObj?.initials} (${colleagueObj?.title}):**\n${aiResult.text}`, fromColleague: colleagueRoleId };
    const finalMsgs = [...newMsgs, aiMsg]; setMessages(finalMsgs);
    let title = activeDebate?.title || "Nova debata";
    if (title === "Nova debata" && finalMsgs.length >= 2) { title = finalMsgs[0].text.substring(0, 50) + (finalMsgs[0].text.length > 50 ? "..." : ""); }
    const updatedDebate = { ...activeDebate, messages: finalMsgs, title };
    setActiveDebate(updatedDebate); await saveDebate(updatedDebate);
    let dl = await loadDebateList(activeRole);
    const idx = dl.findIndex(d => d.id === updatedDebate.id);
    const listItem = { id: updatedDebate.id, title, createdAt: updatedDebate.createdAt };
    if (idx >= 0) { dl[idx] = listItem; } else { dl.unshift(listItem); }
    await saveDebateList(activeRole, dl); setDebates(dl); setLoading(false);
  };

  const AskColleagueModal = () => {
    const [q, setQ] = useState("");
    const others = ROLES.filter(r => r.id !== activeRole);
    const selected = askColleague?.roleId;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setAskColleague(null)}>
        <div style={{ width: "440px", background: "#fff", borderRadius: "16px", overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "#1a1a1a" }}>Zeptat se kolegy</div>
            <div style={{ fontSize: "11px", color: "rgba(0,0,0,0.3)", marginTop: "2px" }}>Vyber koho a napis dotaz</div>
          </div>
          <div style={{ padding: "16px 24px" }}>
            <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
              {others.map(r => (
                <div key={r.id} onClick={() => setAskColleague({ roleId: r.id, roleName: r.title })}
                  style={{ flex: 1, padding: "10px 8px", borderRadius: "10px", border: selected === r.id ? "2px solid #1a1a1a" : "1px solid rgba(0,0,0,0.08)", background: selected === r.id ? "rgba(26,26,26,0.05)" : "transparent", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 600, color: "#fff", margin: "0 auto 6px" }}>{r.initials}</div>
                  <div style={{ fontSize: "10px", fontWeight: 500, color: "#1a1a1a" }}>{r.title}</div>
                </div>
              ))}
            </div>
            <input type="text" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && selected && q.trim()) askColleagueFn(selected, q); }}
              placeholder="Napis dotaz..." style={{ width: "100%", padding: "12px 16px", border: "1px solid rgba(0,0,0,0.08)", borderRadius: "10px", fontFamily: font, fontSize: "13px", outline: "none", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: "8px", marginTop: "12px", justifyContent: "flex-end" }}>
              <div onClick={() => setAskColleague(null)} style={{ padding: "10px 20px", borderRadius: "10px", fontSize: "12px", fontWeight: 500, color: "rgba(0,0,0,0.4)", cursor: "pointer" }}>Zrusit</div>
              <div onClick={() => { if (selected && q.trim()) askColleagueFn(selected, q); }}
                style={{ padding: "10px 20px", borderRadius: "10px", background: selected && q.trim() ? "#1a1a1a" : "rgba(26,26,26,0.2)", color: "#fff", fontSize: "12px", fontWeight: 500, cursor: selected && q.trim() ? "pointer" : "default" }}>Zeptat se</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const SettingsModal = () => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setSettingsOpen(false)}>
      <div style={{ width: "640px", maxHeight: "85vh", background: "#fff", borderRadius: "16px", overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "24px 28px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a" }}>Nastaveni</div>
          <div onClick={() => setSettingsOpen(false)} style={{ width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
        </div>
        <div style={{ display: "flex", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          {[{k:"pamet",l:"Pamet"}].map(t => (
            <div key={t.k} onClick={() => setSettingsTab(t.k)} style={{ flex: 1, padding: "14px", textAlign: "center", fontSize: "12px", fontWeight: 500, color: settingsTab === t.k ? "#1a1a1a" : "rgba(0,0,0,0.25)", borderBottom: settingsTab === t.k ? "2px solid #1a1a1a" : "2px solid transparent", cursor: "pointer" }}>{t.l}</div>
          ))}
        </div>
        <div style={{ padding: "24px 28px", maxHeight: "65vh", overflow: "auto" }}>
          {settingsTab === "pamet" && (
            <div>
              <div style={{ fontSize: "12px", color: "rgba(0,0,0,0.4)", lineHeight: 1.6, marginBottom: "16px" }}>Kazda role si pamatuje historii debat. Zde muzes smazat vsechny debaty dane role.</div>
              {[...ROLES, PORADA].map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "#f8f8f8", borderRadius: "10px", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ width: "24px", height: "24px", borderRadius: "6px", background: "#1a1a1a", color: "#fff", fontSize: "8px", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{r.initials}</span>
                    <span style={{ fontSize: "13px", fontWeight: 500, color: "#1a1a1a" }}>{r.title}</span>
                  </div>
                  <div onClick={async () => { const dl = await loadDebateList(r.id); for (const d of dl) { await sDel("debate-" + d.id); } await sDel("debates-" + r.id); if (activeRole === r.id) { setDebates([]); setMessages([]); setActiveDebate(null); } }} style={{ fontSize: "11px", color: "rgba(0,0,0,0.3)", cursor: "pointer", padding: "6px 12px", borderRadius: "6px", border: "1px solid rgba(0,0,0,0.08)", transition: "all 0.2s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.2)"; e.currentTarget.style.color = "#1a1a1a"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)"; e.currentTarget.style.color = "rgba(0,0,0,0.3)"; }}>Smazat vse</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (screen === "files") {
    const filesByCategory = {};
    FILE_CATEGORIES.forEach(c => { filesByCategory[c.id] = files.filter(f => f.category === c.id); });
    const handleFileDrop = async (e) => {
      e.preventDefault();
      const droppedFiles = Array.from(e.dataTransfer?.files || []);
      const newFiles = [];
      for (const f of droppedFiles) {
        const content = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          if (f.type.startsWith('text/') || f.name.endsWith('.txt') || f.name.endsWith('.md') || f.name.endsWith('.json') || f.name.endsWith('.csv')) {
            reader.readAsText(f);
          } else {
            reader.readAsDataURL(f);
          }
        });
        newFiles.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          name: f.name,
          size: f.size,
          type: f.type,
          content: content,
          category: categorizeFile(f.name),
          addedAt: new Date().toISOString(),
          driveStatus: "lokalni"
        });
      }
      const updated = [...files, ...newFiles];
      setFiles(updated);
      await sSet("files-list", updated);
    };
    const removeFile = async (fileId) => {
      const updated = files.filter(f => f.id !== fileId);
      setFiles(updated);
      await sSet("files-list", updated);
    };
    const moveFile = async (fileId, newCategory) => {
      const updated = files.map(f => f.id === fileId ? { ...f, category: newCategory } : f);
      setFiles(updated);
      await sSet("files-list", updated);
    };
    const [viewingFile, setViewingFile] = useState(null);
    
    const FileViewerModal = () => (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }} onClick={() => setViewingFile(null)}>
        <div style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "800px", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: "12px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div style={{ flex: 1, fontSize: "14px", fontWeight: 600, color: "#1a1a1a" }}>{viewingFile?.name}</div>
            <div onClick={() => setViewingFile(null)} style={{ width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "rgba(0,0,0,0.05)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
            {viewingFile?.content?.startsWith('data:image') ? (
              <img src={viewingFile.content} alt={viewingFile.name} style={{ maxWidth: "100%", borderRadius: "8px" }} />
            ) : viewingFile?.content?.startsWith('data:') ? (
              <div style={{ textAlign: "center", padding: "40px", color: "rgba(0,0,0,0.4)" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" style={{ margin: "0 auto 12px" }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div style={{ fontSize: "13px" }}>Nahled neni k dispozici</div>
                <a href={viewingFile.content} download={viewingFile.name} style={{ display: "inline-block", marginTop: "12px", padding: "10px 20px", background: "#1a1a1a", color: "#fff", borderRadius: "8px", fontSize: "12px", textDecoration: "none" }}>Stahnout soubor</a>
              </div>
            ) : (
              <pre style={{ fontSize: "12px", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#1a1a1a", margin: 0, lineHeight: 1.6 }}>{viewingFile?.content || "Obsah neni k dispozici"}</pre>
            )}
          </div>
        </div>
      </div>
    );
    
    return (
      <div style={{ fontFamily: font, background: "#0d0d0f", width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", boxSizing: "border-box" }}>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        {viewingFile && <FileViewerModal />}
        <div style={{ width: "100%", maxWidth: "1400px", height: "calc(100vh - 40px)", borderRadius: "16px", overflow: "hidden", boxShadow: "0 80px 180px rgba(0,0,0,0.7)", background: "#f8f8f8", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "24px 32px", background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: "14px" }}>
            <div onClick={() => setScreen("home")} style={{ width: "38px", height: "38px", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a" }}>Soubory</div>
              <div style={{ fontSize: "11px", color: "rgba(0,0,0,0.3)" }}>Znalostni baze firmy -- {files.length} souboru</div>
            </div>
            <div style={{ marginLeft: "auto", fontSize: "11px", color: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", gap: "6px" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              Google Drive -- pripojit
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}
            onDragOver={(e) => e.preventDefault()} onDrop={handleFileDrop}>
            <div style={{ border: "2px dashed rgba(0,0,0,0.08)", borderRadius: "14px", padding: "24px", textAlign: "center", marginBottom: "24px", transition: "all 0.2s" }}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "rgba(0,0,0,0.2)"; e.currentTarget.style.background = "rgba(0,0,0,0.02)"; }}
              onDragLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)"; e.currentTarget.style.background = "transparent"; }}
              onDrop={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)"; e.currentTarget.style.background = "transparent"; handleFileDrop(e); }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 8px", display: "block" }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <div style={{ fontSize: "13px", fontWeight: 500, color: "rgba(0,0,0,0.3)" }}>Pretahni soubory sem</div>
              <div style={{ fontSize: "11px", color: "rgba(0,0,0,0.2)", marginTop: "4px" }}>Automaticky se zaradi do kategorie</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {FILE_CATEGORIES.map(cat => {
                const catFiles = filesByCategory[cat.id] || [];
                return (
                  <div key={cat.id} style={{ background: "#fff", borderRadius: "14px", padding: "20px", border: "1px solid rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                      <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 600, color: "#fff" }}>{cat.icon}</div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#1a1a1a" }}>{cat.name}</div>
                        <div style={{ fontSize: "10px", color: "rgba(0,0,0,0.3)" }}>{cat.desc}</div>
                      </div>
                      <div style={{ marginLeft: "auto", fontSize: "11px", color: "rgba(0,0,0,0.2)", fontWeight: 500 }}>{catFiles.length}</div>
                    </div>
                    {catFiles.length === 0 && (
                      <div style={{ fontSize: "11px", color: "rgba(0,0,0,0.15)", textAlign: "center", padding: "12px 0" }}>Zadne soubory</div>
                    )}
                    {catFiles.map(f => (
                      <div key={f.id} onClick={() => setViewingFile(f)} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px", marginBottom: "4px", background: "rgba(0,0,0,0.02)", cursor: "pointer", transition: "background 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.02)"; }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <div style={{ flex: 1, fontSize: "11px", fontWeight: 400, color: "#1a1a1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                        <div style={{ fontSize: "9px", color: f.driveStatus === "nahrano" ? "rgba(45,90,39,0.6)" : "rgba(0,0,0,0.2)" }}>{f.driveStatus === "nahrano" ? "Drive" : "lokalni"}</div>
                        <div onClick={(e) => { e.stopPropagation(); removeFile(f.id); }} style={{ width: "20px", height: "20px", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: 0.3, transition: "opacity 0.15s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "home") {
    return (
      <div style={{ fontFamily: font, background: "#0d0d0f", width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "0", boxSizing: "border-box", overflow: "auto" }}>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        {settingsOpen && <SettingsModal />}
        <div style={{ width: "100%", minHeight: "100vh", borderRadius: "0", overflow: "hidden", background: "#0d0d0f", position: "relative", display: "flex", flexDirection: "column" }}>
          <div style={{ position: "absolute", top: "-200px", right: "-200px", width: "600px", height: "600px", background: "radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)", pointerEvents: "none" }} />
          <div style={{ padding: isMobile ? "20px" : "32px 48px", display: "flex", alignItems: "center", gap: "16px", position: "relative", zIndex: 1, flexWrap: "wrap" }}>
            <div style={{ width: "42px", height: "42px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff", letterSpacing: "0.5px" }}>AI Poradni sbor</div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", letterSpacing: "1px" }}>YOU&PLACE</div>
            </div>
            {!isMobile && (
              <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
                {[{l:"Porada",action:()=>openRole("porada")},{l:"Soubory",action:()=>setScreen("files")}].map(b => (
                  <div key={b.l} onClick={b.action||undefined} style={{ padding: "10px 16px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", transition: "all 0.2s", color: "rgba(255,255,255,0.35)", fontSize: "12px", fontWeight: 500 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}>{b.l}</div>
                ))}
                <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
                <div onClick={() => setSettingsOpen(true)} style={{ width: "40px", height: "40px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                </div>
              </div>
            )}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: isMobile ? "flex-start" : "center", alignItems: "center", padding: isMobile ? "20px" : "0 48px 48px", position: "relative", zIndex: 1 }}>
            <div style={{ maxWidth: "750px", width: "100%" }}>
            {/* INBOX - Pro tebe */}
            {inbox.length > 0 && (
              <div style={{ marginBottom: "32px" }}>
                <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "4px", color: "rgba(255,255,255,0.25)", marginBottom: "16px" }}>Pro tebe ({inbox.length})</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {inbox.slice(0, 3).map(item => {
                    const roleId = DEPT_TO_ROLE[item.fromDepartment] || item.fromDepartment;
                    const role = ROLES.find(r => r.id === roleId);
                    return (
                      <div key={item.id} style={{ background: "rgba(255,255,255,0.04)", border: item.priority === "high" ? "2px solid #dc2626" : "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "20px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                          <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{role?.initials || "?"}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "4px" }}>{role?.title || item.fromDepartment}</div>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "6px" }}>{item.title}</div>
                            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginBottom: "14px" }}>{item.description}</div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              {item.type === "approval" && (<>
                                <div onClick={() => resolveInboxItem(item.id, { approved: true })} style={{ padding: "10px 20px", background: "#fff", color: "#0d0d0f", borderRadius: "10px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Schvalit</div>
                                <div onClick={() => resolveInboxItem(item.id, { approved: false })} style={{ padding: "10px 20px", background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}>Odmitnout</div>
                              </>)}
                              {(item.type === "info" || item.type === "alert" || item.type === "decision") && (
                                <div onClick={() => resolveInboxItem(item.id, { acknowledged: true })} style={{ padding: "10px 20px", background: "#fff", color: "#0d0d0f", borderRadius: "10px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Rozumim</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "4px", color: "rgba(255,255,255,0.25)", marginBottom: "8px" }}>Vyber poradce</div>
            <div style={{ fontSize: isMobile ? "28px" : "42px", fontWeight: 600, color: "#fff", lineHeight: 1.1, marginBottom: "8px" }}>S kym chces<br/>mluvit?</div>
            <div style={{ fontSize: isMobile ? "13px" : "14px", fontWeight: 300, color: "rgba(255,255,255,0.4)", marginBottom: isMobile ? "24px" : "40px", maxWidth: "400px", lineHeight: 1.7 }}>Kazdy clen tymu ma svou specializaci. Vyber roli a zacni konverzaci.</div>
            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                {ROLES.slice(0, 3).map((r) => (
                  <div key={r.id} onClick={() => openRole(r.id)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: isMobile ? "16px" : "24px 20px", cursor: "pointer", transition: "all 0.25s" }}
                    onMouseEnter={(e) => { if (!isMobile) { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.transform = "translateY(-2px)"; } }}
                    onMouseLeave={(e) => { if (!isMobile) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.transform = "translateY(0)"; } }}>
                    <div style={{ display: "flex", alignItems: isMobile ? "center" : "flex-start", gap: isMobile ? "14px" : "0", flexDirection: isMobile ? "row" : "column" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: isMobile ? "0" : "14px", flexShrink: 0 }}>{r.initials}</div>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "2px" }}>{r.title}</div>
                        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: isMobile ? "0" : "8px" }}>{r.subtitle}</div>
                        {!isMobile && <div style={{ fontSize: "11px", fontWeight: 300, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>{r.desc}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px", maxWidth: isMobile ? "100%" : "500px", margin: "0 auto" }}>
                {ROLES.slice(3).map((r) => (
                  <div key={r.id} onClick={() => openRole(r.id)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: isMobile ? "16px" : "24px 20px", cursor: "pointer", transition: "all 0.25s" }}
                    onMouseEnter={(e) => { if (!isMobile) { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.transform = "translateY(-2px)"; } }}
                    onMouseLeave={(e) => { if (!isMobile) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.transform = "translateY(0)"; } }}>
                    <div style={{ display: "flex", alignItems: isMobile ? "center" : "flex-start", gap: isMobile ? "14px" : "0", flexDirection: isMobile ? "row" : "column" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: isMobile ? "0" : "14px", flexShrink: 0 }}>{r.initials}</div>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "2px" }}>{r.title}</div>
                        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: isMobile ? "0" : "8px" }}>{r.subtitle}</div>
                        {!isMobile && <div style={{ fontSize: "11px", fontWeight: 300, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>{r.desc}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", maxWidth: "420px", margin: "0 auto", flexDirection: isMobile ? "column" : "row" }}>
              {[
                { label: "Gmail", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
                { label: "Kalendar", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
              ].map((item) => (
                <div key={item.label} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", padding: "14px 22px", background: "#fff", borderRadius: "60px", cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 20px rgba(255,255,255,0.06)" }}
                  onMouseEnter={(e) => { if (!isMobile) { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(255,255,255,0.1)"; } }}
                  onMouseLeave={(e) => { if (!isMobile) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(255,255,255,0.06)"; } }}>
                  <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{item.icon}</div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#1a1a1a" }}>{item.label}</span>
                </div>
              ))}
            </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const role = activeRole === "porada" ? PORADA : ROLES.find((r) => r.id === activeRole);

  return (
    <div style={{ fontFamily: font, background: "#0d0d0f", width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? "0" : "20px", boxSizing: "border-box" }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      {settingsOpen && <SettingsModal />}
      {askColleague && <AskColleagueModal />}
      <div style={{ width: "100%", maxWidth: isMobile ? "100%" : "1400px", height: isMobile ? "100vh" : "calc(100vh - 40px)", borderRadius: isMobile ? "0" : "16px", overflow: "hidden", boxShadow: isMobile ? "none" : "0 80px 180px rgba(0,0,0,0.7)", display: "flex", background: "#f8f8f8" }}>
        {!isMobile && (
        <div style={{ width: "280px", background: "#0d0d0f", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", gap: "6px" }}>
            <div onClick={goHome} style={{ width: "38px", height: "38px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </div>
            {ROLES.map((r) => (
              <div key={r.id} onClick={() => openRole(r.id)} title={r.title} style={{ width: "38px", height: "38px", borderRadius: "10px", background: activeRole === r.id ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.03)", border: activeRole === r.id ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "10px", fontWeight: 600, color: activeRole === r.id ? "#fff" : "rgba(255,255,255,0.3)", transition: "all 0.2s", flexShrink: 0 }}
                onMouseEnter={(e) => { if (activeRole !== r.id) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; } }}
                onMouseLeave={(e) => { if (activeRole !== r.id) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "rgba(255,255,255,0.3)"; } }}>
                {r.initials}
              </div>
            ))}
          </div>
          <div style={{ padding: "0 16px 12px" }}>
            <div onClick={() => newDebate()} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span style={{ fontSize: "12px", fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>Nova debata</span>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 8px" }}>
            {debates.map((d) => (
              <div key={d.id} onClick={() => openDebate(d)} style={{ padding: "10px 12px", borderRadius: "8px", cursor: "pointer", marginBottom: "2px", background: activeDebate?.id === d.id ? "rgba(255,255,255,0.08)" : "transparent", transition: "all 0.15s" }}
                onMouseEnter={(e) => { if (activeDebate?.id !== d.id) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { if (activeDebate?.id !== d.id) e.currentTarget.style.background = "transparent"; }}>
                <div style={{ fontSize: "12px", fontWeight: 500, color: activeDebate?.id === d.id ? "#fff" : "rgba(255,255,255,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</div>
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", marginTop: "2px" }}>{new Date(d.createdAt).toLocaleDateString("cs-CZ")}</div>
              </div>
            ))}
            {debates.length === 0 && (<div style={{ padding: "20px 12px", textAlign: "center", fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>Zatim zadne debaty</div>)}
          </div>
          <div style={{ padding: "12px 16px" }}>
            <div onClick={() => setSettingsOpen(true)} style={{ width: "38px", height: "38px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            </div>
          </div>
        </div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: isMobile ? "16px" : "20px 32px", background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: "14px" }}>
            {isMobile && (
              <div onClick={goHome} style={{ width: "38px", height: "38px", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              </div>
            )}
            <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 600, color: "#fff" }}>{role?.initials}</div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: "#1a1a1a" }}>{role?.title}</div>
              <div style={{ fontSize: "11px", color: "rgba(0,0,0,0.3)" }}>{role?.subtitle}</div>
            </div>
            {activeRole !== "porada" && !isMobile && (
              <div onClick={() => setAskColleague({ roleId: null, roleName: null })} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)", cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.03)"; e.currentTarget.style.borderColor = "rgba(0,0,0,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)"; }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                <span style={{ fontSize: "11px", fontWeight: 500, color: "rgba(0,0,0,0.4)" }}>Zeptat se kolegy</span>
              </div>
            )}
            {activeRole === "porada" && !isMobile && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "11px", color: "rgba(0,0,0,0.3)", marginRight: "4px" }}>Ucastnici:</span>
                {ROLES.map(r => (
                  <div key={r.id} onClick={() => togglePoradaMember(r.id)}
                    style={{ width: "34px", height: "34px", borderRadius: "8px", background: poradaMembers.includes(r.id) ? "#1a1a1a" : "rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 600, color: poradaMembers.includes(r.id) ? "#fff" : "rgba(0,0,0,0.25)", cursor: "pointer", transition: "all 0.2s", border: poradaMembers.includes(r.id) ? "none" : "1px solid rgba(0,0,0,0.08)" }}
                    title={r.title}>
                    {r.initials}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "24px 32px", display: "flex", flexDirection: "column", gap: "20px" }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ width: "56px", height: "56px", borderRadius: "14px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 600, color: "#fff", margin: "0 auto 16px" }}>{role?.initials}</div>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", marginBottom: "4px" }}>{role?.title}</div>
                  <div style={{ fontSize: "12px", color: "rgba(0,0,0,0.3)", maxWidth: "300px" }}>{role?.desc}</div>
                </div>
              </div>
            )}
            {/* Interni komunikace */}
            {internalComms.length > 0 && (
              <div style={{ background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.2)", borderRadius: "12px", padding: "16px", marginBottom: "8px" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, color: "#2563eb", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "1px" }}>Interni komunikace</div>
                {internalComms.slice(-3).map((c, i) => (
                  <div key={i} style={{ fontSize: "12px", color: "#1e40af", marginBottom: "8px", padding: "8px 12px", background: "rgba(255,255,255,0.6)", borderRadius: "8px" }}>
                    <div style={{ fontWeight: 600, marginBottom: "4px" }}>{ROLE_MAP[c.from] || c.from} se pta {c.to}: {c.question}</div>
                    <div style={{ color: "#1a1a1a" }}>{c.response?.substring(0, 200)}{c.response?.length > 200 ? "..." : ""}</div>
                  </div>
                ))}
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", gap: "10px" }}>
                {msg.role === "ai" && <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 600, color: "#fff", flexShrink: 0, marginTop: "2px" }}>{role?.initials}</div>}
                <div style={{ maxWidth: "70%" }}>
                  <div style={{ padding: "14px 18px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: msg.role === "user" ? "#1a1a1a" : "#fff", color: msg.role === "user" ? "#fff" : "#1a1a1a", fontSize: "13px", fontWeight: 300, lineHeight: 1.7, boxShadow: msg.role === "ai" ? "0 2px 8px rgba(0,0,0,0.04)" : "none", whiteSpace: "pre-wrap" }}>{msg.text}</div>
                  {msg.files && msg.files.length > 0 && (
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                      {msg.files.map((f, fi) => (
                        <a key={fi} href={`data:text/plain;charset=utf-8,${encodeURIComponent(f.content)}`} download={f.name} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", background: "#1a1a1a", color: "#fff", borderRadius: "8px", fontSize: "11px", textDecoration: "none", cursor: "pointer" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          {f.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 600, color: "#fff", flexShrink: 0 }}>{role?.initials}</div>
                <div style={{ padding: "14px 18px", borderRadius: "14px 14px 14px 4px", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {[0,1,2].map(d => <div key={d} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(0,0,0,0.15)", animation: `pulse 1.2s ease-in-out ${d*0.2}s infinite` }} />)}
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: isMobile ? "12px 16px 20px" : "16px 32px 24px", background: dragOver ? "rgba(26,26,26,0.04)" : "transparent" }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleChatFileDrop}>
            {dragOver && <div style={{ textAlign: "center", padding: "12px", fontSize: "12px", color: "rgba(0,0,0,0.3)", border: "2px dashed rgba(0,0,0,0.1)", borderRadius: "12px", marginBottom: "8px" }}>Pust soubor sem</div>}
            {chatAttachments.length > 0 && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                {chatAttachments.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", background: "#f0f0f0", borderRadius: "8px", fontSize: "11px", color: "#1a1a1a" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    {a.name}
                    <div onClick={() => setChatAttachments(prev => prev.filter((_, j) => j !== i))} style={{ cursor: "pointer", opacity: 0.5 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#fff", borderRadius: "14px", padding: "6px 6px 6px 16px", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
              <input type="file" ref={fileInputRef} onChange={handleFileInputChange} multiple style={{ display: "none" }} />
              <svg onClick={() => fileInputRef.current?.click()} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: "pointer", flexShrink: 0 }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={isMobile ? "Napis zpravu..." : `Zeptej se: ${role?.title || ""}...`} style={{ flex: 1, border: "none", outline: "none", fontFamily: font, fontSize: "13px", color: "#1a1a1a", background: "transparent" }} />
              <button onClick={sendMessage} disabled={loading || (!inputValue.trim() && chatAttachments.length === 0)} style={{ width: "38px", height: "38px", borderRadius: "10px", background: loading || (!inputValue.trim() && chatAttachments.length === 0) ? "rgba(26,26,26,0.3)" : "#1a1a1a", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: loading ? "wait" : "pointer", flexShrink: 0, transition: "background 0.2s" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @media (max-width: 768px) {
          .desktop-sidebar { display: none !important; }
          .chat-container { border-radius: 0 !important; height: 100vh !important; }
          .chat-header { padding: 16px !important; }
          .chat-messages { padding: 16px !important; }
          .chat-input-area { padding: 12px 16px 20px !important; }
        }
      `}</style>
    </div>
  );
}
