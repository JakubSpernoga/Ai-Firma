import { getFirestore } from "../lib/firebase.js";

export default async function handler(req, res) {
  try {
    const db = getFirestore();
    const testRef = db.collection("_health_check");
    await testRef.limit(1).get();
    
    return res.status(200).json({
      status: "ok",
      firestore: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
