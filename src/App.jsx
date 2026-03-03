import { useState, useEffect, useRef } from "react";

const DEPARTMENTS = {
  finance: { id: "finance", name: "Finance", title: "Financni reditel", initials: "FR", color: "#2563eb", description: "Dane, cashflow, rozpocty" },
  projects: { id: "projects", name: "Projekty", title: "Projektovy manazer", initials: "PM", color: "#059669", description: "Rizeni zakazek" },
  crm: { id: "crm", name: "CRM", title: "Obchodni manazer", initials: "CRM", color: "#d97706", description: "Poptavky, klienti" },
  administration: { id: "administration", name: "Administrativa", title: "Asistentka", initials: "AS", color: "#7c3aed", description: "Emaily, dokumenty" },
  ceo: { id: "ceo", name: "CEO", title: "Business analytik", initials: "BA", color: "#dc2626", description: "Strategie, analyzy" }
};

const DEPT_LIST = Object.values(DEPARTMENTS);

export default function App() {
  const [screen, setScreen] = useState("home");
  const [activeDept, setActiveDept] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [inboxByDept, setInboxByDept] = useState({});
  const [internalComms, setInternalComms] = useState([]);
  const chatEndRef = useRef(null);

  useEffect(() => { loadInbox(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const loadInbox = async () => {
    try {
      const res = await fetch("/api/inbox");
      const data = await res.json();
      if (data.items) {
        setInbox(data.items);
        const byDept = {};
        data.items.forEach(item => {
          if (!byDept[item.fromDepartment]) byDept[item.fromDepartment] = [];
          byDept[item.fromDepartment].push(item);
        });
        setInboxByDept(byDept);
      }
    } catch (e) { console.error(e); }
  };

  const openDepartment = (deptId) => {
    setActiveDept(deptId);
    setScreen("chat");
    setMessages([]);
    setConversationId(null);
    setInternalComms([]);
  };

  const goHome = () => {
    setScreen("home");
    setActiveDept(null);
    setMessages([]);
    setInternalComms([]);
    loadInbox();
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || loading) return;
    const userMsg = { role: "user", text: inputValue.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInputValue("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: activeDept, message: userMsg.text, conversationId })
      });
      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, { role: "assistant", text: "Chyba: " + data.error }]);
      } else {
        if (data.conversationId) setConversationId(data.conversationId);
        const newComms = [];
        if (data.actionResults) {
          data.actionResults.forEach(ar => {
            if (ar.result && ar.result.response) {
              newComms.push({ from: activeDept, to: ar.result.fromDepartment, response: ar.result.response });
            }
          });
        }
        if (newComms.length > 0) setInternalComms(prev => [...prev, ...newComms]);
        setMessages(prev => [...prev, { role: "assistant", text: data.message, actions: data.actions, actionResults: data.actionResults }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", text: "Chyba: " + e.message }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const resolveInboxItem = async (itemId, resolution) => {
    try {
      await fetch("/api/inbox", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: itemId, resolution, status: "resolved" }) });
      loadInbox();
    } catch (e) { console.error(e); }
  };

  const dept = activeDept ? DEPARTMENTS[activeDept] : null;

  if (screen === "home") {
    return (
      <div style={{ minHeight: "100vh", background: "#f8f9fa", padding: "40px 20px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#1a1a1a", marginBottom: "8px" }}>YouPlace AI System</h1>
            <p style={{ fontSize: "14px", color: "#666" }}>Interni operacni system firmy</p>
          </div>

          {inbox.length > 0 && (
            <div style={{ marginBottom: "40px" }}>
              <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#666", marginBottom: "16px", textTransform: "uppercase" }}>Pro tebe ({inbox.length})</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {inbox.map(item => (
                  <div key={item.id} style={{ background: "#fff", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: item.priority === "high" ? "2px solid #dc2626" : "1px solid #eee" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: DEPARTMENTS[item.fromDepartment]?.color || "#666", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "12px", fontWeight: "600" }}>{DEPARTMENTS[item.fromDepartment]?.initials || "?"}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}>{DEPARTMENTS[item.fromDepartment]?.title}</div>
                        <div style={{ fontSize: "15px", fontWeight: "600", color: "#1a1a1a", marginBottom: "6px" }}>{item.title}</div>
                        <div style={{ fontSize: "13px", color: "#444", marginBottom: "12px" }}>{item.description}</div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {item.type === "approval" && (<><button onClick={() => resolveInboxItem(item.id, { approved: true })} style={{ padding: "8px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}>Schvalit</button><button onClick={() => resolveInboxItem(item.id, { approved: false })} style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}>Odmitnout</button></>)}
                          {(item.type === "info" || item.type === "alert") && (<button onClick={() => resolveInboxItem(item.id, { acknowledged: true })} style={{ padding: "8px 16px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}>OK</button>)}
                          <button onClick={() => openDepartment(item.fromDepartment)} style={{ padding: "8px 16px", background: "#fff", color: "#1a1a1a", border: "1px solid #ddd", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}>Chat</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 style={{ fontSize: "14px", fontWeight: "600", color: "#666", marginBottom: "16px", textTransform: "uppercase" }}>Oddeleni</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
            {DEPT_LIST.map(d => {
              const deptInbox = inboxByDept[d.id] || [];
              const hasItems = deptInbox.length > 0;
              return (
                <div key={d.id} onClick={() => openDepartment(d.id)} style={{ background: "#fff", borderRadius: "16px", padding: "24px", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: hasItems ? "2px solid " + d.color : "1px solid #eee", position: "relative" }}>
                  {hasItems && (<div style={{ position: "absolute", top: "12px", right: "12px", width: "24px", height: "24px", borderRadius: "50%", background: d.color, color: "#fff", fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center" }}>{deptInbox.length}</div>)}
                  <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: d.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>{d.initials}</div>
                  <div style={{ fontSize: "16px", fontWeight: "600", color: "#1a1a1a", marginBottom: "4px" }}>{d.title}</div>
                  <div style={{ fontSize: "12px", color: "#666" }}>{d.description}</div>
                  {hasItems && (<div style={{ marginTop: "12px", padding: "8px 12px", background: "#f0f9ff", borderRadius: "8px", fontSize: "11px", color: d.color, fontWeight: "500" }}>{deptInbox[0].title}</div>)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#f8f9fa" }}>
      <div style={{ padding: "16px 24px", background: "#fff", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: "16px" }}>
        <button onClick={goHome} style={{ width: "40px", height: "40px", borderRadius: "10px", border: "1px solid #eee", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
        <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: dept?.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "14px", fontWeight: "600" }}>{dept?.initials}</div>
        <div><div style={{ fontSize: "15px", fontWeight: "600", color: "#1a1a1a" }}>{dept?.title}</div><div style={{ fontSize: "12px", color: "#666" }}>{dept?.description}</div></div>
      </div>

      {inboxByDept[activeDept] && inboxByDept[activeDept].length > 0 && (
        <div style={{ padding: "16px 24px", background: "#fff8e6", borderBottom: "1px solid #f0e6cc" }}>
          <div style={{ fontSize: "12px", fontWeight: "600", color: "#92400e", marginBottom: "12px" }}>CEKA NA TEBE ({inboxByDept[activeDept].length})</div>
          {inboxByDept[activeDept].map(item => (
            <div key={item.id} style={{ background: "#fff", borderRadius: "8px", padding: "12px", marginBottom: "8px", border: "1px solid #f0e6cc" }}>
              <div style={{ fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>{item.title}</div>
              <div style={{ display: "flex", gap: "8px" }}>
                {item.type === "approval" && (<><button onClick={() => resolveInboxItem(item.id, { approved: true })} style={{ padding: "6px 12px", background: "#059669", color: "#fff", border: "none", borderRadius: "6px", fontSize: "11px", cursor: "pointer" }}>Schvalit</button><button onClick={() => resolveInboxItem(item.id, { approved: false })} style={{ padding: "6px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", fontSize: "11px", cursor: "pointer" }}>Odmitnout</button></>)}
                {(item.type === "info" || item.type === "alert") && (<button onClick={() => resolveInboxItem(item.id, { acknowledged: true })} style={{ padding: "6px 12px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "11px", cursor: "pointer" }}>OK</button>)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
        {messages.length === 0 && (<div style={{ textAlign: "center", marginTop: "80px" }}><div style={{ width: "64px", height: "64px", borderRadius: "16px", background: dept?.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "20px", fontWeight: "600", margin: "0 auto 16px" }}>{dept?.initials}</div><div style={{ fontSize: "18px", fontWeight: "600", color: "#1a1a1a", marginBottom: "8px" }}>{dept?.title}</div><div style={{ fontSize: "14px", color: "#666" }}>{dept?.description}</div></div>)}

        {messages.map((msg, i) => (<div key={i} style={{ marginBottom: "16px", display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}><div style={{ maxWidth: "70%", padding: "14px 18px", borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: msg.role === "user" ? "#1a1a1a" : "#fff", color: msg.role === "user" ? "#fff" : "#1a1a1a", fontSize: "14px", lineHeight: "1.6", boxShadow: msg.role === "assistant" ? "0 2px 8px rgba(0,0,0,0.06)" : "none", whiteSpace: "pre-wrap" }}>{msg.text}{msg.actionResults && msg.actionResults.length > 0 && (<div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(0,0,0,0.1)" }}>{msg.actionResults.map((ar, j) => (<div key={j} style={{ fontSize: "11px", color: ar.success ? "#059669" : "#dc2626", marginBottom: "4px" }}>{ar.success ? "OK" : "Err"}: {ar.action}</div>))}</div>)}</div></div>))}

        {internalComms.length > 0 && (<div style={{ margin: "16px 0", padding: "16px", background: "#f0f9ff", borderRadius: "12px", border: "1px solid #bfdbfe" }}><div style={{ fontSize: "11px", fontWeight: "600", color: "#1d4ed8", marginBottom: "12px" }}>INTERNI KOMUNIKACE</div>{internalComms.map((comm, i) => (<div key={i} style={{ fontSize: "13px", marginBottom: "8px" }}><span style={{ fontWeight: "600" }}>{DEPARTMENTS[comm.from]?.initials} {"->"} {DEPARTMENTS[comm.to]?.initials}:</span> {comm.response}</div>))}</div>)}

        {loading && (<div style={{ display: "flex", gap: "8px", padding: "14px 18px", background: "#fff", borderRadius: "16px", width: "fit-content", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ccc", animation: "pulse 1s infinite" }}></div><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ccc", animation: "pulse 1s infinite 0.2s" }}></div><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ccc", animation: "pulse 1s infinite 0.4s" }}></div></div>)}
        <div ref={chatEndRef} />
      </div>

      <div style={{ padding: "16px 24px", background: "#fff", borderTop: "1px solid #eee" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={"Napis zpravu..."} style={{ flex: 1, padding: "14px 18px", border: "1px solid #eee", borderRadius: "12px", fontSize: "14px", outline: "none" }} />
          <button onClick={sendMessage} disabled={loading || !inputValue.trim()} style={{ width: "48px", height: "48px", borderRadius: "12px", background: loading || !inputValue.trim() ? "#ccc" : "#1a1a1a", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
        </div>
      </div>
      <style>{"@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }"}</style>
    </div>
  );
}
