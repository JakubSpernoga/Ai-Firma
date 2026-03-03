// BA Proaktivni analyza - spusti se pri otevreni aplikace
import { getDocs, getSubDocs, createDoc } from '../lib/firebase.js';
import { callDepartmentAI } from '../lib/action-engine.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Zkontroluj jestli uz dnes byla analyza
    const today = new Date().toISOString().split('T')[0];
    const existingSuggestions = await getDocs('suggestions', {
      where: [['date', '==', today], ['status', '==', 'pending']],
      limit: 1
    });

    if (existingSuggestions.length > 0) {
      // Uz existuji dnesni navrhy, vrat je
      const allToday = await getDocs('suggestions', {
        where: [['date', '==', today]],
        orderBy: 'createdAt',
        orderDirection: 'desc'
      });
      return res.status(200).json({ suggestions: allToday, cached: true });
    }

    // Seber data ze systemu pro analyzu
    const systemData = await gatherSystemData();

    // Zavolej BA pro analyzu
    const analysisPrompt = buildAnalysisPrompt(systemData);
    const baResponse = await callDepartmentAI('ceo', analysisPrompt, []);

    // Parsuj navrhy z odpovedi
    const suggestions = parseBAResponse(baResponse, today);

    // Uloz navrhy do databaze
    for (const suggestion of suggestions) {
      await createDoc('suggestions', suggestion);
    }

    return res.status(200).json({ suggestions, cached: false });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function gatherSystemData() {
  const data = {
    tasks: { open: 0, inProgress: 0, done: 0, overdue: 0 },
    departments: {},
    recentActivity: []
  };

  // Projdi vsechna oddeleni
  const deptIds = ['finance', 'projects', 'crm', 'administration', 'ceo'];
  
  for (const deptId of deptIds) {
    try {
      const tasks = await getSubDocs('departments', deptId, 'tasks', { limit: 50 });
      data.departments[deptId] = { taskCount: tasks.length };
      
      tasks.forEach(task => {
        if (task.status === 'open') data.tasks.open++;
        if (task.status === 'in_progress') data.tasks.inProgress++;
        if (task.status === 'done') data.tasks.done++;
        if (task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done') {
          data.tasks.overdue++;
        }
      });
    } catch (e) {
      data.departments[deptId] = { taskCount: 0, error: e.message };
    }
  }

  // Posledni notifikace
  try {
    const notifications = await getDocs('notifications', { limit: 20, orderBy: 'createdAt', orderDirection: 'desc' });
    data.recentActivity = notifications.map(n => n.text);
  } catch (e) {}

  return data;
}

function buildAnalysisPrompt(systemData) {
  return `Analyzuj stav firmy a navrhni 1-3 konkretni zlepseni.

AKTUALNI DATA:
- Ukoly: ${systemData.tasks.open} otevrenych, ${systemData.tasks.inProgress} rozpracovanych, ${systemData.tasks.done} hotovych
- Zpozdene ukoly: ${systemData.tasks.overdue}
- Posledni aktivita: ${systemData.recentActivity.slice(0, 5).join('; ')}

PRAVIDLA PRO NAVRHY:
1. Kazdy navrh musi byt KONKRETNI a AKCNI
2. Musi obsahovat: problem, reseni, prinos (v KC nebo case), narocnost
3. Priorita: quick_win (do tydne), strednedoba (mesic), dlouhodoba (ctvrtleti)
4. Max 3 navrhy

Odpovez JSON:
{
  "message": "Shrnuti analyzy",
  "suggestions": [
    {
      "title": "Nazev navrhu",
      "problem": "Co je spatne",
      "solution": "Co udelat",
      "benefit": "Prinos v KC nebo case",
      "effort": "Narocnost (hodiny/dny)",
      "priority": "quick_win|strednedoba|dlouhodoba",
      "target_department": "kdo to bude resit"
    }
  ]
}`;
}

function parseBAResponse(response, date) {
  const suggestions = [];
  
  if (response.suggestions && Array.isArray(response.suggestions)) {
    response.suggestions.forEach(s => {
      suggestions.push({
        date: date,
        status: 'pending',
        rejectionCount: 0,
        title: s.title || 'Bez nazvu',
        problem: s.problem || '',
        solution: s.solution || '',
        benefit: s.benefit || '',
        effort: s.effort || '',
        priority: s.priority || 'strednedoba',
        targetDepartment: s.target_department || 'ceo'
      });
    });
  }

  return suggestions;
}
