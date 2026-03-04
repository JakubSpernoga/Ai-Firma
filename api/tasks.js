import { getSubDocs, createSubDoc, updateSubDoc } from "../lib/firebase.js";
import { DEPARTMENTS } from "../lib/departments.js";

export default async function handler(req, res) {
  const { method } = req;

  if (method === "GET") {
    const { department } = req.query;
    if (!department || !DEPARTMENTS[department]) return res.status(400).json({ error: "Invalid department" });
    try {
      const tasks = await getSubDocs("departments", department, "tasks", { orderBy: "createdAt", orderDirection: "desc" });
      return res.status(200).json({ tasks });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (method === "POST") {
    const { department, title, description, priority } = req.body;
    if (!department || !title) return res.status(400).json({ error: "Missing params" });
    try {
      const taskId = await createSubDoc("departments", department, "tasks", { title, description: description || "", status: "open", priority: priority || "medium", createdBy: "user" });
      return res.status(200).json({ taskId });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (method === "PUT") {
    const { department, taskId, status } = req.body;
    if (!department || !taskId || !status) return res.status(400).json({ error: "Missing params" });
    try {
      await updateSubDoc("departments", department, "tasks", taskId, { status });
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
