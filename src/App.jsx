import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import * as mammoth from "mammoth";

async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          let result = '';
          workbook.SheetNames.forEach(sheetName => { result += '\n=== ' + sheetName + ' ===\n' + XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false }); });
          resolve({ type: 'text', content: result });
        } catch (err) { resolve({ type: 'error', content: err.message }); }
      };
      reader.readAsArrayBuffer(file);
    });
  }
  if (name.endsWith('.docx')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => { try { const r = await mammoth.extractRawText({ arrayBuffer: e.target.result }); resolve({ type: 'text', content: r.value }); } catch (err) { resolve({ type: 'error', content: err.message }); } };
      reader.readAsArrayBuffer(file);
    });
  }
  if (name.endsWith('.pdf')) { return new Promise((resolve) => { const reader = new FileReader(); reader.onload = (e) => resolve({ type: 'pdf', content: e.target.result }); reader.readAsDataURL(file); }); }
  if (name.match(/\.(jpg|jpeg|png|gif|webp)$/)) { return new Promise((resolve) => { const reader = new FileReader(); reader.onload = (e) => resolve({ type: 'image', content: e.target.result }); reader.readAsDataURL(file); }); }
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = (e) => resolve({ type: 'text', content: e.target.result }); reader.readAsText(file); });
}

const DEPT_MAP = { financak: "finance", asistentka: "administration", inovator: "ceo", zadavatel: "projects", stavbar: "crm" };
const ROLES = [
  { id: "financak", initials: "FR", title: "Financni reditel", subtitle: "Dane, cashflow, rozpocty", desc: "Danovy expert a CFO. Resi DPH, dane z prijmu, pojisteni, odpisy, cashflow, rozpocty staveb." },
  { id: "asistentka", initials: "AS", title: "Asistentka", subtitle: "Emaily, dokumenty, organizace", desc: "Organizace, komunikace, dokumenty. Pripravuje emaily, smlouvy, nabidky." },
  { id: "inovator", initials: "BA", title: "Business analytik", subtitle: "Strategie, analyzy, navrhy", desc: "Strategicky poradce. Hleda zpusoby jak rust a automatizovat firmu." },
  { id: "zadavatel", initials: "PM", title: "Projektovy manazer", subtitle: "Rizeni zakazek", desc: "Ridi projekty a zakazky. Harmonogramy, subdodavatele, rozpocty." },
  { id: "stavbar", initials: "CRM", title: "Obchodni manazer", subtitle: "Poptavky, klienti", desc: "CRM a obchod. Spravuje poptavky, klienty, nabidky." }
];
const font = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

export default function App() {
  const [screen, setScreen] = useState("home");
  const [activeRole, setActiveRole] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [inboxByDept, setInboxByDept] = useState({});
  const [internalComms, setInternalComms] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);
  useEffect(() => { loadInbox(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const loadInbox = async () => { try { const res = await fetch("/api/inbox"); const data = await res.json(); if (data.items) { setInbox(data.items); const byDept = {}; data.items.forEach(item => { const roleId = Object.keys(DEPT_MAP).find(k => DEPT_MAP[k] === item.fromDepartment) || item.fromDepartment; if (!byDept[roleId]) byDept[roleId] = []; byDept[roleId].push(item); }); setInboxByDept(byDept); } } catch (e) {} };
  const openRole = (id) => { setActiveRole(id); setScreen("chat"); setMessages([]); setConversationId(null); setInternalComms([]); };
  const goHome = () => { setScreen("home"); setActiveRole(null); setMessages([]); setInternalComms([]); loadInbox(); };
  const handleDrop = async (e) => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer?.files || []); const atts = []; for (const f of files) { const p = await parseFile(f); atts.push({ name: f.name, content: p.content, parsedType: p.type }); } setChatAttachments(prev => [...prev, ...atts]); };
  const handleFileInput = async (e) => { const files = Array.from(e.target.files || []); const atts = []; for (const f of files) { const p = await parseFile(f); atts.push({ name: f.name, content: p.content, parsedType: p.type }); } setChatAttachments(prev => [...prev, ...atts]); e.target.value = ''; };

  const sendMessage = async () => {
    if ((!inputValue.trim() && chatAttachments.length === 0) || loading) return;
    let userText = inputValue.trim();
    chatAttachments.forEach(a => { if (a.parsedType === 'text' && a.content) userText += '\n\n=== ' + a.name + ' ===\n' + a.content; });
    const userMsg = { role: "user", text: userText };
    setMessages(prev => [...prev, userMsg]); setInputValue(""); setChatAttachments([]); setLoading(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department: DEPT_MAP[activeRole], message: userText, conversationId }) });
      const data = await res.json();
      if (data.error) { setMessages(prev => [...prev, { role: "ai", text: "Chyba: " + data.error }]); }
      else {
        if (data.conversationId) setConversationId(data.conversationId);
        if (data.actionResults) { const comms = []; data.actionResults.forEach(ar => { if (ar.result?.response) comms.push({ from: activeRole, to: ar.result.fromDepartment, response: ar.result.response }); }); if (comms.length) setInternalComms(prev => [...prev, ...comms]); }
        let aiText = data.message;
        if (data.actionResults?.length) { const info = data.actionResults.map(ar => ar.success ? (ar.action === "create_task" ? "Ukol vytvoren" : ar.action === "notify" ? "Notifikace" : ar.action === "request_from_user" ? "Ceka na schvaleni" : ar.action + ": OK") : ar.action + ": Chyba").join(", "); aiText += "\n\n[" + info + "]"; }
        setMessages(prev => [...prev, { role: "ai", text: aiText }]);
      }
    } catch (e) { setMessages(prev => [...prev, { role: "ai", text: "Chyba: " + e.message }]); }
    setLoading(false); loadInbox();
  };

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  const resolveInbox = async (id, resolution) => { try { await fetch("/api/inbox", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, resolution, status: "resolved" }) }); loadInbox(); } catch (e) {} };
  const role = ROLES.find(r => r.id === activeRole);

  if (screen === "home") {
    return (
      <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: font }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "24px 16px" : "48px 32px" }}>
          <div style={{ textAlign: "center", marginBottom: isMobile ? "32px" : "48px" }}>
            <h1 style={{ fontSize: isMobile ? "28px" : "36px", fontWeight: 700, color: "#1a1a1a", marginBottom: "8px" }}>AI Firma</h1>
            <p style={{ fontSize: "14px", color: "rgba(0,0,0,0.4)" }}>Interni operacni system You&Place</p>
          </div>
          {inbox.length > 0 && (
            <div style={{ marginBottom: "40px" }}>
              <h2 style={{ fontSize: "11px", fontWeight: 600, color: "rgba(0,0,0,0.3)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "1px" }}>Pro tebe ({inbox.length})</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {inbox.slice(0, 3).map(item => { const r = ROLES.find(x => DEPT_MAP[x.id] === item.fromDepartment); return (
                  <div key={item.id} style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", border: item.priority === "high" ? "2px solid #dc2626" : "1px solid rgba(0,0,0,0.06)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                      <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "11px", fontWeight: 600 }}>{r?.initials || "?"}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "11px", color: "rgba(0,0,0,0.3)", marginBottom: "4px" }}>{r?.title}</div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#1a1a1a", marginBottom: "6px" }}>{item.title}</div>
                        <div style={{ fontSize: "12px", color: "rgba(0,0,0,0.5)", marginBottom: "14px" }}>{item.description}</div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {item.type === "approval" && (<><button onClick={() => resolveInbox(item.id, { approved: true })} style={{ padding: "8px 16px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "8px", fontSize: "11px", cursor: "pointer" }}>Schvalit</button><button onClick={() => resolveInbox(item.id, { approved: false })} style={{ padding: "8px 16px", background: "#fff", color: "#1a1a1a", border: "1px solid rgba(0,0,0,0.1)", borderRadius: "8px", fontSize: "11px", cursor: "pointer" }}>Odmitnout</button></>)}
                          {(item.type === "info" || item.type === "alert") && (<button onClick={() => resolveInbox(item.id, { acknowledged: true })} style={{ padding: "8px 16px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "8px", fontSize: "11px", cursor: "pointer" }}>Rozumim</button>)}
                        </div>
                      </div>
                    </div>
                  </div>
                ); })}
              </div>
            </div>
          )}
          <h2 style={{ fontSize: "11px", fontWeight: 600, color: "rgba(0,0,0,0.3)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "1px" }}>Oddeleni</h2>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            {ROLES.map(r => { const has = (inboxByDept[r.id] || []).length; return (
              <div key={r.id} onClick={() => openRole(r.id)} style={{ background: "#fff", borderRadius: "16px", padding: "24px", cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", border: has ? "2px solid #1a1a1a" : "1px solid rgba(0,0,0,0.06)", position: "relative", transition: "all 0.2s" }}>
                {has > 0 && <div style={{ position: "absolute", top: "16px", right: "16px", width: "22px", height: "22px", borderRadius: "50%", background: "#1a1a1a", color: "#fff", fontSize: "10px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{has}</div>}
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "14px", fontWeight: 600, marginBottom: "16px" }}>{r.initials}</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#1a1a1a", marginBottom: "4px" }}>{r.title}</div>
                <div style={{ fontSize: "12px", color: "rgba(0,0,0,0.4)" }}>{r.subtitle}</div>
              </div>
            ); })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", background: "#fafafa", fontFamily: font }}>
      {!isMobile && (
        <div style={{ width: "280px", background: "#fff", borderRight: "1px solid rgba(0,0,0,0.06)", padding: "24px 16px", display: "flex", flexDirection: "column" }}>
          <div onClick={goHome} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px", borderRadius: "10px", cursor: "pointer", marginBottom: "24px" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg><span style={{ fontSize: "13px", color: "rgba(0,0,0,0.5)" }}>Zpet</span></div>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "rgba(0,0,0,0.25)", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px", paddingLeft: "12px" }}>Oddeleni</div>
          {ROLES.map(r => (<div key={r.id} onClick={() => openRole(r.id)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "4px", background: activeRole === r.id ? "rgba(0,0,0,0.04)" : "transparent" }}><div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 600, color: "#fff" }}>{r.initials}</div><div><div style={{ fontSize: "13px", fontWeight: 500, color: "#1a1a1a" }}>{r.title}</div><div style={{ fontSize: "10px", color: "rgba(0,0,0,0.3)" }}>{r.subtitle}</div></div></div>))}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: isMobile ? "16px" : "20px 32px", background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: "14px" }}>
          {isMobile && <div onClick={goHome} style={{ width: "38px", height: "38px", borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="1.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></div>}
          <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 600, color: "#fff" }}>{role?.initials}</div>
          <div><div style={{ fontSize: "15px", fontWeight: 600, color: "#1a1a1a" }}>{role?.title}</div><div style={{ fontSize: "11px", color: "rgba(0,0,0,0.3)" }}>{role?.subtitle}</div></div>
        </div>
        {internalComms.length > 0 && (<div style={{ padding: "12px 32px", background: "#f0f9ff", borderBottom: "1px solid #bfdbfe" }}><div style={{ fontSize: "10px", fontWeight: 600, color: "#1d4ed8", marginBottom: "8px", textTransform: "uppercase" }}>Interni komunikace</div>{internalComms.map((c, i) => (<div key={i} style={{ fontSize: "12px", color: "#1e40af", marginBottom: "4px" }}><strong>{ROLES.find(r => r.id === c.from)?.initials} -&gt; {c.to}:</strong> {c.response?.substring(0, 100)}...</div>))}</div>)}
        <div style={{ flex: 1, overflow: "auto", padding: "24px 32px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {messages.length === 0 && (<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ textAlign: "center" }}><div style={{ width: "56px", height: "56px", borderRadius: "14px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 600, color: "#fff", margin: "0 auto 16px" }}>{role?.initials}</div><div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", marginBottom: "4px" }}>{role?.title}</div><div style={{ fontSize: "12px", color: "rgba(0,0,0,0.3)", maxWidth: "300px" }}>{role?.desc}</div></div></div>)}
          {messages.map((msg, i) => (<div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", gap: "10px" }}>{msg.role === "ai" && <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 600, color: "#fff", flexShrink: 0, marginTop: "2px" }}>{role?.initials}</div>}<div style={{ maxWidth: "70%" }}><div style={{ padding: "14px 18px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: msg.role === "user" ? "#1a1a1a" : "#fff", color: msg.role === "user" ? "#fff" : "#1a1a1a", fontSize: "13px", fontWeight: 300, lineHeight: 1.7, boxShadow: msg.role === "ai" ? "0 2px 8px rgba(0,0,0,0.04)" : "none", whiteSpace: "pre-wrap" }}>{msg.text}</div></div></div>))}
          {loading && (<div style={{ display: "flex", gap: "10px" }}><div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 600, color: "#fff" }}>{role?.initials}</div><div style={{ padding: "14px 18px", borderRadius: "14px 14px 14px 4px", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}><div style={{ display: "flex", gap: "4px" }}>{[0,1,2].map(d => <div key={d} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(0,0,0,0.15)", animation: "pulse 1.2s ease-in-out " + (d*0.2) + "s infinite" }} />)}</div></div></div>)}
          <div ref={chatEndRef} />
        </div>
        <div style={{ padding: isMobile ? "12px 16px 20px" : "16px 32px 24px", background: dragOver ? "rgba(26,26,26,0.04)" : "transparent" }} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
          {dragOver && <div style={{ textAlign: "center", padding: "12px", fontSize: "12px", color: "rgba(0,0,0,0.3)", border: "2px dashed rgba(0,0,0,0.1)", borderRadius: "12px", marginBottom: "8px" }}>Pust soubor sem</div>}
          {chatAttachments.length > 0 && (<div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>{chatAttachments.map((a, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", background: "#f0f0f0", borderRadius: "8px", fontSize: "11px", color: "#1a1a1a" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>{a.name}<div onClick={() => setChatAttachments(prev => prev.filter((_, j) => j !== i))} style={{ cursor: "pointer", opacity: 0.5 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></div></div>))}</div>)}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#fff", borderRadius: "14px", padding: "6px 6px 6px 16px", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
            <input type="file" ref={fileInputRef} onChange={handleFileInput} multiple style={{ display: "none" }} />
            <svg onClick={() => fileInputRef.current?.click()} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" style={{ cursor: "pointer" }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={"Napis zpravu pro " + (role?.title || "") + "..."} style={{ flex: 1, border: "none", outline: "none", fontFamily: font, fontSize: "13px", color: "#1a1a1a", background: "transparent" }} />
            <button onClick={sendMessage} disabled={loading || (!inputValue.trim() && chatAttachments.length === 0)} style={{ width: "38px", height: "38px", borderRadius: "10px", background: loading || (!inputValue.trim() && chatAttachments.length === 0) ? "rgba(26,26,26,0.3)" : "#1a1a1a", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: loading ? "wait" : "pointer" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
          </div>
        </div>
      </div>
      <style>{"@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }"}</style>
    </div>
  );
}
