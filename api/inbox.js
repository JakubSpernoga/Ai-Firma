// Inbox API - polozky cekajici na schvaleni od uzivatele
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getDb() {
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  try {
    const db = getDb();
    
    if (req.method === "GET") {
      const snapshot = await db.collection("user_inbox")
        .where("status", "==", "pending")
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
      
      const items = [];
      snapshot.forEach(doc => {
        items.push({ id: doc.id, ...doc.data() });
      });
      
      return res.status(200).json({ items });
    }
    
    if (req.method === "PUT") {
      const { id, resolution, status } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      
      await db.collection("user_inbox").doc(id).update({
        status: status || "resolved",
        resolution: resolution || null,
        resolvedAt: new Date().toISOString()
      });
      
      return res.status(200).json({ success: true });
    }
    
    if (req.method === "POST") {
      const { type, fromDepartment, title, description, priority, options } = req.body;
      
      const docRef = await db.collection("user_inbox").add({
        type: type || "info",
        fromDepartment: fromDepartment || "system",
        title: title || "Bez nazvu",
        description: description || "",
        priority: priority || "medium",
        options: options || null,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      
      return res.status(200).json({ id: docRef.id });
    }
    
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Inbox error:", error);
    return res.status(500).json({ error: error.message });
  }
}
