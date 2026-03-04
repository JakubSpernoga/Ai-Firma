// chat-2.js
// Prijima roleId misto celeho system promptu
// Prompty tahne ze system-prompts.js -- jediny zdroj pravdy

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getDb() {
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

// Importujeme prompty ze system-prompts.js
import { getSystemPrompt } from "../lib/system-prompts.js";

const ROLE_NAMES = {
  financak: "Financni reditel",
  asistentka: "Asistentka",
  inovator: "Business analytik",
  zadavatel: "Programator",
  stavbar: "Stavebni specialista",
  porada: "Porada"
};

const ROLE_MAP = { AS: "asistentka", FR: "financak", BA: "inovator", PR: "zadavatel", ST: "stavbar" };

async function callClaude(messages, systemPrompt, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-opus-4-20250514",
      max_tokens: 16000,
      system: systemPrompt,
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
        const targetPrompt = getSystemPrompt(targetDept);
        const colleagueResponse = await callClaude(
          [{ role: "user", content: `[Dotaz od ${ROLE_NAMES[sourceDept] || sourceDept}]: ${question}` }],
          targetPrompt,
          apiKey
        );
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

// Zpracuj [SCHVALENI: nazev | popis | priorita] tagy
async function processSchvaleni(text, sourceDept, db) {
  const schvaleniRegex = /\[SCHVALENI:\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(low|medium|high)\s*\]/gi;
  let match;
  const results = [];

  while ((match = schvaleniRegex.exec(text)) !== null) {
    const title = match[1].trim();
    const description = match[2].trim();
    const priority = match[3].trim();

    try {
      await db.collection("user_inbox").add({
        type: "approval",
        fromDepartment: sourceDept,
        title,
        description,
        priority,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      results.push({ type: "schvaleni", success: true, title });
    } catch (e) {
      results.push({ type: "schvaleni", success: false, error: e.message });
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
    const db = getDb();

    // Novy format: { roleId, messages, poradaMembers? }
    // Stary format fallback: { messages, system }
    let roleId = req.body.roleId || null;
    let systemPrompt = null;

    if (roleId) {
      // Novy format -- tahni prompt ze system-prompts.js
      const poradaMembers = req.body.poradaMembers || null;
      systemPrompt = getSystemPrompt(roleId, poradaMembers);
    } else if (req.body.system) {
      // Stary format fallback -- detekuj roli z textu promptu
      const systemText = req.body.system || "";
      if (systemText.includes("Asistentka") || systemText.includes("Executive Assistant")) roleId = "asistentka";
      else if (systemText.includes("Business Analytik") || systemText.includes("inovator")) roleId = "inovator";
      else if (systemText.includes("Programator") || systemText.includes("Technical PM")) roleId = "zadavatel";
      else if (systemText.includes("stavebni inzenyr") || systemText.includes("Stavbar")) roleId = "stavbar";
      else roleId = "financak";
      systemPrompt = req.body.system;
    } else {
      return res.status(400).json({ error: "Missing roleId or system prompt" });
    }

    // Formatuj zpravy
    const formattedMessages = (req.body.messages || []).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: typeof m.content === "string" ? m.content : (m.text || "")
    }));

    // Zavolej Claude
    let responseText = await callClaude(formattedMessages, systemPrompt, apiKey);

    // Zpracuj [AKCE:...] tagy
    const actionResults = await processActions(responseText, roleId, db, apiKey);

    // Zpracuj [SCHVALENI:...] tagy
    const schvaleniResults = await processSchvaleni(responseText, roleId, db);
    actionResults.push(...schvaleniResults);

    // Zpracuj [DELEGOVAT: XX] tagy -- zavolej kolegu a prida jeho odpoved
    const internalComms = [];
    const delegateRegex = /\[DELEGOVAT:\s*(FR|AS|BA|PR|ST)\]\s*(.+?)(?=\[DELEGOVAT:|$)/gs;
    const currentRoleName = ROLE_NAMES[roleId] || roleId;
    const delegations = [];
    let match;

    while ((match = delegateRegex.exec(responseText)) !== null) {
      delegations.push({ role: ROLE_MAP[match[1]], task: match[2].trim() });
    }

    for (const del of delegations) {
      if (!del.role) continue;
      const colleaguePrompt = getSystemPrompt(del.role);
      const colleagueMsg = [{ role: "user", content: `[Ukol od ${currentRoleName}] ${del.task}` }];
      const colleagueResponse = await callClaude(colleagueMsg, colleaguePrompt, apiKey);
      responseText += `\n\n---\n**${ROLE_NAMES[del.role]} odpovida:**\n${colleagueResponse}`;
      internalComms.push({
        from: roleId,
        to: del.role,
        question: del.task,
        response: colleagueResponse
      });

      // Uloz do Firebase
      try {
        await db.collection("internal_communications").add({
          initiatedBy: roleId,
          target: del.role,
          question: del.task,
          response: colleagueResponse,
          createdAt: new Date().toISOString()
        });
      } catch (e) {
        // Firebase chyba -- nekritická, pokracuj
      }
    }

    // Odstran delegacni tagy z finalniho textu
    responseText = responseText.replace(/\[DELEGOVAT:\s*(FR|AS|BA|PR|ST)\]\s*/g, "");

    // Odstran [SCHVALENI:...] tagy z textu (uz jsou zpracovane)
    responseText = responseText.replace(/\[SCHVALENI:[^\]]+\]/gi, "").trim();

    // Pridej summary akcí
    if (actionResults.length > 0) {
      const summaryParts = actionResults.map(a => {
        if (a.type === "create_task") return `[Ukol vytvoren pro ${a.target}]`;
        if (a.type === "notify") return `[Notifikace odeslana]`;
        if (a.type === "request_approval" || a.type === "schvaleni") return `[Ceka na schvaleni: ${a.title}]`;
        if (a.type === "ask_department") return `[Odpoved od ${a.target}]`;
        if (a.type === "generate_file") return `[Soubor vytvoren: ${a.name}]`;
        return `[${a.type}]`;
      });
      responseText = responseText.replace(/\[AKCE:[^\]]+\]/g, "").trim();
      if (summaryParts.length > 0) {
        responseText += "\n\n" + summaryParts.join(" ");
      }
    }

    // Vrat v puvodnim formatu ktery ocekava App.jsx
    return res.status(200).json({
      content: [{ type: "text", text: responseText }],
      actionResults,
      internalComms
    });

  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: error.message });
  }
}
