// Firebase Admin SDK inicializace pro serverove funkce (Vercel API routes)
// Tento soubor se pouziva POUZE na serveru, ne v prohlizeci

import admin from 'firebase-admin';

// Inicializace Firebase Admin
// Pri deploymentu se pouzije FIREBASE_SERVICE_ACCOUNT env variable
function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
  }

  try {
    const credentials = JSON.parse(serviceAccount);
    
    return admin.initializeApp({
      credential: admin.credential.cert(credentials),
      storageBucket: `${credentials.project_id}.firebasestorage.app`
    });
  } catch (error) {
    throw new Error(`Failed to initialize Firebase: ${error.message}`);
  }
}

// Lazy initialization
let app = null;
let db = null;
let storage = null;

export function getFirebaseApp() {
  if (!app) {
    app = initFirebase();
  }
  return app;
}

export function getFirestore() {
  if (!db) {
    getFirebaseApp();
    db = admin.firestore();
  }
  return db;
}

export function getStorage() {
  if (!storage) {
    getFirebaseApp();
    storage = admin.storage();
  }
  return storage;
}

// Pomocne funkce pro praci s Firestore

// Ziskani dokumentu
export async function getDoc(collection, docId) {
  const db = getFirestore();
  const doc = await db.collection(collection).doc(docId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// Ziskani vsech dokumentu v kolekci
export async function getDocs(collection, options = {}) {
  const db = getFirestore();
  let query = db.collection(collection);
  
  if (options.where) {
    for (const [field, op, value] of options.where) {
      query = query.where(field, op, value);
    }
  }
  
  if (options.orderBy) {
    query = query.orderBy(options.orderBy, options.orderDirection || 'desc');
  }
  
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Vytvoreni dokumentu
export async function createDoc(collection, data) {
  const db = getFirestore();
  const docRef = await db.collection(collection).add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return docRef.id;
}

// Aktualizace dokumentu
export async function updateDoc(collection, docId, data) {
  const db = getFirestore();
  await db.collection(collection).doc(docId).update({
    ...data,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Smazani dokumentu
export async function deleteDoc(collection, docId) {
  const db = getFirestore();
  await db.collection(collection).doc(docId).delete();
}

// Pomocna funkce pro subkolekce (napr. departments/finance/messages)
export async function getSubDocs(parentCollection, parentId, subCollection, options = {}) {
  const db = getFirestore();
  let query = db.collection(parentCollection).doc(parentId).collection(subCollection);
  
  if (options.where) {
    for (const [field, op, value] of options.where) {
      query = query.where(field, op, value);
    }
  }
  
  if (options.orderBy) {
    query = query.orderBy(options.orderBy, options.orderDirection || 'desc');
  }
  
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function createSubDoc(parentCollection, parentId, subCollection, data) {
  const db = getFirestore();
  const docRef = await db.collection(parentCollection).doc(parentId).collection(subCollection).add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return docRef.id;
}

export async function updateSubDoc(parentCollection, parentId, subCollection, docId, data) {
  const db = getFirestore();
  await db.collection(parentCollection).doc(parentId).collection(subCollection).doc(docId).update({
    ...data,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

export default {
  getFirebaseApp,
  getFirestore,
  getStorage,
  getDoc,
  getDocs,
  createDoc,
  updateDoc,
  deleteDoc,
  getSubDocs,
  createSubDoc,
  updateSubDoc
};
