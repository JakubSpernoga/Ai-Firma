import { getDocs, updateDoc } from "../lib/firebase.js";

export default async function handler(req, res) {
  const { method } = req;

  if (method === "GET") {
    try {
      const items = await getDocs("user_inbox", { where: [["status", "==", "pending"]], orderBy: "createdAt", orderDirection: "desc" });
      return res.status(200).json({ items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (method === "PUT") {
    const { id, resolution, status } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    try {
      await updateDoc("user_inbox", id, { status: status || "resolved", resolution: resolution || null, resolvedAt: new Date().toISOString() });
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
