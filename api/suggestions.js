import { getDocs, updateDoc, createDoc } from '../lib/firebase.js';
import { processActions } from '../lib/action-engine.js';

export default async function handler(req, res) {
  const { method } = req;

  if (method === 'GET') {
    const { status } = req.query;
    try {
      const where = status ? [['status', '==', status]] : [];
      const suggestions = await getDocs('suggestions', { where, orderBy: 'createdAt', orderDirection: 'desc', limit: 50 });
      return res.status(200).json({ suggestions });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (method === 'PUT') {
    const { id, action, reason } = req.body;
    if (!id || !action) return res.status(400).json({ error: 'Missing params' });

    try {
      const now = new Date().toISOString();

      if (action === 'approve') {
        await updateDoc('suggestions', id, { status: 'approved', resolvedAt: now });
        return res.status(200).json({ success: true, action: 'approved' });
      }

      if (action === 'reject') {
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + 30);
        await updateDoc('suggestions', id, { status: 'rejected', lastRejectedAt: now, nextReviewDate: nextReview.toISOString() });
        return res.status(200).json({ success: true, action: 'rejected' });
      }

      if (action === 'postpone') {
        const postponeUntil = new Date();
        postponeUntil.setDate(postponeUntil.getDate() + 3);
        await updateDoc('suggestions', id, { status: 'postponed', postponedUntil: postponeUntil.toISOString() });
        return res.status(200).json({ success: true, action: 'postponed' });
      }

      if (action === 'archive') {
        await updateDoc('suggestions', id, { status: 'archived', permanentlyArchived: true, archivedAt: now });
        return res.status(200).json({ success: true, action: 'archived' });
      }

      return res.status(400).json({ error: 'Invalid action' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
