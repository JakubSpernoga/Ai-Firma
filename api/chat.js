import { createSubDoc, getSubDocs } from "../lib/firebase.js";
import { processActions, callDepartmentAI } from "../lib/action-engine.js";
import { validateClaudeResponse } from "../lib/actions.js";
import { DEPARTMENTS } from "../lib/departments.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { department, message, conversationId, attachments } = req.body;
  if (!department || !message) return res.status(400).json({ error: "Missing params" });
  if (!DEPARTMENTS[department]) return res.status(400).json({ error: "Invalid department" });

  try {
    const convId = conversationId || Date.now().toString();
    await createSubDoc("departments", department, "messages", { role: "user", text: message, conversationId: convId });
    const history = await getSubDocs("departments", department, "messages", { where: [["conversationId", "==", convId]], orderBy: "createdAt", limit: 20 });
    const aiResponse = await callDepartmentAI(department, message, history.slice(0, -1));
    
    let actionResults = [];
    if (aiResponse.actions && aiResponse.actions.length > 0) {
      actionResults = await processActions(aiResponse.actions, department, convId);
    }

    await createSubDoc("departments", department, "messages", { role: "assistant", text: aiResponse.message, conversationId: convId, actions: aiResponse.actions || [] });
    return res.status(200).json({ message: aiResponse.message, actions: aiResponse.actions || [], actionResults, conversationId: convId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
