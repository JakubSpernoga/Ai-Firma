// Action Engine - jadro systemu
// Validuje a vykonava akce z Claude odpovedi

import { 
  createSubDoc, 
  updateSubDoc, 
  getSubDocs,
  createDoc,
  getFirestore 
} from './firebase.js';
import { validateClaudeResponse, applyDefaults } from './actions.js';
import { getModelForDepartment, DEPARTMENTS } from './departments.js';
import { getSystemPrompt } from './system-prompts.js';

// Hlavni funkce - zpracuje odpoved z Claude a vykona akce
export async function processClaudeResponse(response, sourceDepartment) {
  const results = {
    success: true,
    message: response.message,
    actionsExecuted: [],
    errors: [],
    internalCommunications: [],
    filesGenerated: [],
    userRequests: []
  };

  // Validace odpovedi
  const validation = validateClaudeResponse(response);
  if (!validation.valid) {
    results.success = false;
    results.errors.push(validation.error);
    return results;
  }

  // Vykonej kazdou akci
  for (const action of response.actions) {
    try {
      const actionWithDefaults = applyDefaults(action);
      const actionResult = await executeAction(actionWithDefaults, sourceDepartment);
      
      results.actionsExecuted.push({
        type: action.type,
        success: true,
        result: actionResult
      });

      // Kategorizuj vysledky
      if (action.type === 'ask_department' || action.type === 'delegate_and_execute') {
        results.internalCommunications.push(actionResult);
      }
      if (action.type === 'generate_file') {
        results.filesGenerated.push(actionResult);
      }
      if (action.type === 'request_from_user') {
        results.userRequests.push(actionResult);
      }

      // Loguj akci
      await logAction(sourceDepartment, action, 'success', actionResult);

    } catch (error) {
      results.actionsExecuted.push({
        type: action.type,
        success: false,
        error: error.message
      });
      results.errors.push(`Action ${action.type}: ${error.message}`);
      
      await logAction(sourceDepartment, action, 'error', { error: error.message });
    }
  }

  results.success = results.errors.length === 0;
  return results;
}

// Vykonani jednotlive akce
async function executeAction(action, sourceDepartment) {
  switch (action.type) {
    case 'create_task':
      return await executeCreateTask(action, sourceDepartment);
    
    case 'update_task_status':
      return await executeUpdateTaskStatus(action);
    
    case 'generate_file':
      return await executeGenerateFile(action, sourceDepartment);
    
    case 'notify':
      return await executeNotify(action, sourceDepartment);
    
    case 'ask_department':
      return await executeAskDepartment(action, sourceDepartment);
    
    case 'delegate_and_execute':
      return await executeDelegateAndExecute(action, sourceDepartment);
    
    case 'request_from_user':
      return await executeRequestFromUser(action, sourceDepartment);
    
    case 'create_summary':
      return await executeCreateSummary(action);
    
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

// CREATE_TASK - vytvori ukol v cilovem oddeleni
async function executeCreateTask(action, sourceDepartment) {
  const taskData = {
    title: action.title,
    description: action.description,
    status: 'open',
    priority: action.priority || 'medium',
    createdBy: sourceDepartment,
    dueDate: action.due_date || null,
    relatedFiles: []
  };

  const taskId = await createSubDoc('departments', action.target_department, 'tasks', taskData);

  // Vytvor notifikaci pro cilove oddeleni
  await createNotification({
    targetDepartment: action.target_department,
    sourceDepartment: sourceDepartment,
    type: 'new_task',
    title: `Novy ukol od ${DEPARTMENTS[sourceDepartment]?.title || sourceDepartment}`,
    text: action.title,
    relatedTaskId: taskId,
    priority: action.priority || 'medium'
  });

  return { taskId, targetDepartment: action.target_department };
}

// UPDATE_TASK_STATUS - zmeni stav ukolu
async function executeUpdateTaskStatus(action) {
  const db = getFirestore();
  
  // Najdi ukol ve vsech oddelenich
  for (const deptId of Object.keys(DEPARTMENTS)) {
    const taskRef = db.collection('departments').doc(deptId).collection('tasks').doc(action.task_id);
    const taskDoc = await taskRef.get();
    
    if (taskDoc.exists) {
      await taskRef.update({
        status: action.status,
        updatedAt: new Date()
      });
      return { taskId: action.task_id, newStatus: action.status, department: deptId };
    }
  }
  
  throw new Error(`Task not found: ${action.task_id}`);
}

// GENERATE_FILE - vygeneruje soubor
async function executeGenerateFile(action, sourceDepartment) {
  // Uloz metadata souboru do Firestore
  const fileData = {
    name: action.title,
    format: action.format,
    content: action.content,
    createdBy: sourceDepartment,
    downloadCount: 0
  };

  const fileId = await createSubDoc('departments', sourceDepartment, 'files', fileData);

  return { 
    fileId, 
    name: action.title, 
    format: action.format,
    department: sourceDepartment
  };
}

// NOTIFY - posle notifikaci
async function executeNotify(action, sourceDepartment) {
  return await createNotification({
    targetDepartment: action.target_department,
    sourceDepartment: sourceDepartment,
    type: 'info',
    title: 'Notifikace',
    text: action.text,
    priority: action.priority || 'medium'
  });
}

// ASK_DEPARTMENT - zepta se jineho oddeleni (synchronni)
async function executeAskDepartment(action, sourceDepartment) {
  // Toto vyzaduje volani Claude API - bude implementovano v chat.js
  // Zde jen vratime strukturu pro pozdejsi zpracovani
  return {
    type: 'ask_department',
    targetDepartment: action.target_department,
    question: action.question,
    reason: action.reason || null,
    sourceDepartment: sourceDepartment,
    needsExecution: true
  };
}

// DELEGATE_AND_EXECUTE - deleguj a proved automaticky
async function executeDelegateAndExecute(action, sourceDepartment) {
  // Toto vyzaduje volani Claude API - bude implementovano v chat.js
  return {
    type: 'delegate_and_execute',
    targetDepartment: action.target_department,
    instruction: action.instruction,
    returnResultTo: action.return_result_to || sourceDepartment,
    notifyUser: action.notify_user !== false,
    sourceDepartment: sourceDepartment,
    needsExecution: true
  };
}

// REQUEST_FROM_USER - vytvor pozadavek pro uzivatele (karta)
async function executeRequestFromUser(action, sourceDepartment) {
  const requestData = {
    type: action.request_type,
    fromDepartment: sourceDepartment,
    title: action.title,
    description: action.description,
    details: action.details || null,
    options: action.options || null,
    file: action.file || null,
    priority: action.priority || 'medium',
    deadline: action.deadline || null,
    status: 'pending',
    resolvedAt: null,
    resolution: null
  };

  const requestId = await createDoc('user_inbox', requestData);

  return { requestId, type: action.request_type, fromDepartment: sourceDepartment };
}

// CREATE_SUMMARY - vytvor shrnuti konverzace
async function executeCreateSummary(action) {
  // Toto vyzaduje volani Claude API pro sumarizaci
  return {
    type: 'create_summary',
    department: action.department,
    conversationId: action.conversation_id,
    needsExecution: true
  };
}

// Pomocna funkce - vytvor notifikaci
async function createNotification(data) {
  const notificationData = {
    targetDepartment: data.targetDepartment,
    sourceDepartment: data.sourceDepartment,
    type: data.type,
    title: data.title,
    text: data.text,
    priority: data.priority || 'medium',
    read: false,
    relatedTaskId: data.relatedTaskId || null,
    relatedFileId: data.relatedFileId || null
  };

  const notificationId = await createDoc('notifications', notificationData);
  return { notificationId, ...notificationData };
}

// Logovani akce
async function logAction(department, action, status, result) {
  const logData = {
    department: department,
    actionType: action.type,
    inputData: action,
    status: status,
    result: result,
    timestamp: new Date()
  };

  await createDoc('action_logs', logData);
}

// Export pro pouziti v API
export default {
  processClaudeResponse,
  executeAction,
  createNotification,
  logAction
};
