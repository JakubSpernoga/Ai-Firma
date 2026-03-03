// Inbox API - s fallback kdyz neni Firebase
export default async function handler(req, res) {
  // Zkus Firebase, ale pokud neni nakonfigurovano, vrat prazdny seznam
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!serviceAccount || serviceAccount === "{}" || serviceAccount.length < 50) {
    // Firebase neni nakonfigurovano - vrat prazdny inbox
    if (req.method === "GET") {
      return res.status(200).json({ items: [] });
    }
    if (req.method === "PUT" || req.method === "POST") {
      return res.status(200).json({ success: true, note: "Firebase not configured" });
    }
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    
    if (getApps().length === 0) {
      const creds = JSON.parse(serviceAccount);
      initializeApp({ credential: cert(creds) });
    }
    const db = getFirestore();
    
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
      const { type, fromDepartment, title, description, priority } = req.body;
      
      const docRef = await db.collection("user_inbox").add({
        type: type || "info",
        fromDepartment: fromDepartment || "system",
        title: title || "Bez nazvu",
        description: description || "",
        priority: priority || "medium",
        status: "pending",
        createdAt: new Date().toISOString()
      });
      
      return res.status(200).json({ id: docRef.id });
    }
    
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Inbox error:", error);
    // Pri chybe vrat prazdny inbox misto 500
    if (req.method === "GET") {
      return res.status(200).json({ items: [], error: error.message });
    }
    return res.status(500).json({ error: error.message });
  }
}
