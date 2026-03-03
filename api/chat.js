// Chat API - kompletni s Action Engine
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getDb() {
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

const DEPT_MAP = {
  financak: "finance",
  asistentka: "administration",
  inovator: "ceo",
  zadavatel: "projects",
  stavbar: "crm"
};

const ROLE_NAMES = {
  finance: "Financni reditel",
  administration: "Asistentka",
  ceo: "Business analytik",
  projects: "Projektovy manazer",
  crm: "Obchodni manazer"
};

const ACTION_INSTRUCTIONS = `

DULEZITE - AKCE:
Kdyz potrebujes neco udelat, pridej do odpovedi AKCI v tomto formatu na KONCI zpravy:

[AKCE:create_task:ODDELENI:NAZEV:POPIS]
- Vytvori ukol pro oddeleni (finance/administration/ceo/projects/crm)

[AKCE:notify:ODDELENI:TEXT]
- Posle notifikaci oddeleni

[AKCE:ask_department:ODDELENI:OTAZKA]
- Zepta se jineho oddeleni a pocka na odpoved

[AKCE:request_approval:NAZEV:POPIS:PRIORITA]
- Pozada uzivatele o schvaleni (priorita: low/medium/high)

[AKCE:generate_file:FORMAT:NAZEV:OBSAH]
- Vygeneruje soubor (format: txt/md/csv)

Priklady:
- Potrebujes vytvorit ukol pro asistentku: [AKCE:create_task:administration:Pripravit smlouvu:SoD pro klienta Novak]
- Potrebujes schvaleni: [AKCE:request_approval:Objednavka materialu:DEK 127500 Kc:high]
- Potrebujes info od stavbare: [AKCE:ask_department:crm:Jaka je cena ETICS za m2?]
`;

async function callClaude(messages, systemPrompt, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      system: systemPrompt + ACTION_INSTRUCTIONS,
      messages: messages
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "API error");
  }
  
  return data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
}

async function processActions(text, sourceDept, db, apiKey) {
  const results = [];
  const actionRegex = /\[AKCE:([^\]:]+):([^\]]+)\]/g;
  let match;
  
  while ((match = actionRegex.exec(text)) !== null) {
    const actionType = match[1];
    const params = match[2].split(":");
    
    try {
      if (actionType === "create_task") {
        const [targetDept, title, description] = params;
        await db.collection("departments").doc(targetDept).collection("tasks").add({
          title: title || "Bez nazvu",
          description: description || "",
          status: "open",
          priority: "medium",
          createdBy: sourceDept,
          createdAt: new Date().toISOString()
        });
        await db.collection("notifications").add({
          targetDepartment: targetDept,
          sourceDepartment: sourceDept,
          text: "Novy ukol: " + title,
          read: false,
          createdAt: new Date().toISOString()
        });
        results.push({ type: "create_task", success: true, target: targetDept, title });
      }
      
      if (actionType === "notify") {
        const [targetDept, ...textParts] = params;
        const notifText = textParts.join(":");
        await db.collection("notifications").add({
          targetDepartment: targetDept,
          sourceDepartment: sourceDept,
          text: notifText,
          read: false,
          createdAt: new Date().toISOString()
        });
        results.push({ type: "notify", success: true, target: targetDept });
      }
      
      if (actionType === "request_approval") {
        const [title, description, priority] = params;
        await db.collection("user_inbox").add({
          type: "approval",
          fromDepartment: sourceDept,
          title: title || "Zadost o schvaleni",
          description: description || "",
          priority: priority || "medium",
          status: "pending",
          createdAt: new Date().toISOString()
        });
        results.push({ type: "request_approval", success: true, title });
      }
      
      if (actionType === "ask_department") {
        const [targetDept, ...questionParts] = params;
        const question = questionParts.join(":");
        
        // Zavolej cilove oddeleni
        const targetPrompt = `Jsi ${ROLE_NAMES[targetDept] || targetDept}. Odpovez strucne a vecne na dotaz od kolegy.`;
        const colleagueResponse = await callClaude(
          [{ role: "user", content: `[Dotaz od ${ROLE_NAMES[sourceDept]}]: ${question}` }],
          targetPrompt,
          apiKey
        );
        
        // Uloz komunikaci
        await db.collection("internal_communications").add({
          initiatedBy: sourceDept,
          target: targetDept,
          question: question,
          response: colleagueResponse,
          createdAt: new Date().toISOString()
        });
        
        results.push({ 
          type: "ask_department", 
          success: true, 
          target: targetDept, 
          question,
          response: colleagueResponse 
        });
      }
      
      if (actionType === "generate_file") {
        const [format, title, ...contentParts] = params;
        const content = contentParts.join(":");
        await db.collection("departments").doc(sourceDept).collection("files").add({
          name: (title || "soubor") + "." + (format || "txt"),
          format: format || "txt",
          content: content || "",
          createdBy: sourceDept,
          createdAt: new Date().toISOString()
        });
        results.push({ type: "generate_file", success: true, name: title });
      }
      
    } catch (e) {
      results.push({ type: actionType, success: false, error: e.message });
    }
  }
  
  return results;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    // Detekuj format - puvodni frontend posila "messages" a "system"
    if (req.body.messages && req.body.system) {
      const db = getDb();
      
      // Extrahuj roli z promptu nebo pouzij default
      let sourceDept = "finance";
      const systemText = req.body.system || "";
      if (systemText.includes("Asistentka") || systemText.includes("Executive Assistant")) sourceDept = "administration";
      else if (systemText.includes("Business Analytik") || systemText.includes("inovator")) sourceDept = "ceo";
      else if (systemText.includes("Programator") || systemText.includes("Technical PM")) sourceDept = "projects";
      else if (systemText.includes("stavebni inzenyr") || systemText.includes("Stavbar")) sourceDept = "crm";
      
      // Zavolej Claude
      const formattedMessages = req.body.messages.map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : m.content
      }));
      
      let responseText = await callClaude(formattedMessages, req.body.system, apiKey);
      
      // Zpracuj akce
      const actionResults = await processActions(responseText, sourceDept, db, apiKey);
      
      // Pridej info o vykonanych akcich do odpovedi
      let internalComms = [];
      if (actionResults.length > 0) {
        const actionSummary = actionResults.map(a => {
          if (a.type === "create_task") return `[Ukol vytvoren pro ${a.target}]`;
          if (a.type === "notify") return `[Notifikace odeslana]`;
          if (a.type === "request_approval") return `[Ceka na schvaleni: ${a.title}]`;
          if (a.type === "ask_department") {
            internalComms.push({ from: sourceDept, to: a.target, question: a.question, response: a.response });
            return `[Odpoved od ${a.target}]`;
          }
          if (a.type === "generate_file") return `[Soubor vytvoren: ${a.name}]`;
          return `[${a.type}]`;
        }).join(" ");
        
        // Odstran akce tagy z textu pro uzivatele
        responseText = responseText.replace(/\[AKCE:[^\]]+\]/g, "").trim();
        responseText += "\n\n" + actionSummary;
      }
      
      // Vrat v puvodnim formatu
      return res.status(200).json({
        content: [{ type: "text", text: responseText }],
        actionResults,
        internalComms
      });
    }
    
    // Fallback - proste proxy
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    return res.status(response.ok ? 200 : response.status).json(data);
    
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: error.message });
  }
}
