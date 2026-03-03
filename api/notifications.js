import { getDocs, createDoc, updateDoc } from "../lib/firebase.js";

export default async function handler(req, res) {
  const { method } = req;

  if (method === "GET") {
    try {
      const notifications = await getDocs("notifications", { orderBy: "createdAt", orderDirection: "desc", limit: 50 });
      return res.status(200).json({ notifications });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (method === "PUT") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    try {
      await updateDoc("notifications", id, { read: true });
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
