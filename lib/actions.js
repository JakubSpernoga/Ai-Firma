// Definice podporovanych akci a jejich schemat

export const ACTION_TYPES = {
  CREATE_TASK: 'create_task',
  UPDATE_TASK_STATUS: 'update_task_status',
  GENERATE_FILE: 'generate_file',
  NOTIFY: 'notify',
  ASK_DEPARTMENT: 'ask_department',
  DELEGATE_AND_EXECUTE: 'delegate_and_execute',
  REQUEST_FROM_USER: 'request_from_user',
  CREATE_SUMMARY: 'create_summary'
};

// Schema pro validaci akci
export const ACTION_SCHEMAS = {
  create_task: {
    required: ['target_department', 'title', 'description'],
    optional: ['priority', 'due_date'],
    defaults: { priority: 'medium' }
  },
  update_task_status: {
    required: ['task_id', 'status'],
    optional: [],
    validStatus: ['open', 'in_progress', 'done']
  },
  generate_file: {
    required: ['format', 'title', 'content'],
    optional: [],
    validFormats: ['pdf', 'docx', 'xlsx', 'txt', 'md']
  },
  notify: {
    required: ['target_department', 'text'],
    optional: ['priority']
  },
  ask_department: {
    required: ['target_department', 'question'],
    optional: ['reason', 'wait_for_response'],
    defaults: { wait_for_response: true }
  },
  delegate_and_execute: {
    required: ['target_department', 'instruction'],
    optional: ['return_result_to', 'notify_user'],
    defaults: { notify_user: true }
  },
  request_from_user: {
    required: ['request_type', 'title', 'description'],
    optional: ['details', 'options', 'file', 'priority', 'deadline'],
    validRequestTypes: ['approval', 'decision', 'info', 'alert']
  },
  create_summary: {
    required: ['department', 'conversation_id'],
    optional: []
  }
};

// Validace jedne akce
export function validateAction(action) {
  if (!action || typeof action !== 'object') {
    return { valid: false, error: 'Action must be an object' };
  }

  if (!action.type) {
    return { valid: false, error: 'Action must have a type' };
  }

  const schema = ACTION_SCHEMAS[action.type];
  if (!schema) {
    return { valid: false, error: `Unknown action type: ${action.type}` };
  }

  // Check required fields
  for (const field of schema.required) {
    if (action[field] === undefined || action[field] === null || action[field] === '') {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate specific constraints
  if (action.type === 'update_task_status' && !schema.validStatus.includes(action.status)) {
    return { valid: false, error: `Invalid status: ${action.status}` };
  }

  if (action.type === 'generate_file' && !schema.validFormats.includes(action.format)) {
    return { valid: false, error: `Invalid format: ${action.format}` };
  }

  if (action.type === 'request_from_user' && !schema.validRequestTypes.includes(action.request_type)) {
    return { valid: false, error: `Invalid request_type: ${action.request_type}` };
  }

  return { valid: true };
}

// Validace cele odpovedi z Claude
export function validateClaudeResponse(response) {
  if (!response || typeof response !== 'object') {
    return { valid: false, error: 'Response must be an object' };
  }

  if (typeof response.message !== 'string') {
    return { valid: false, error: 'Response must have a message string' };
  }

  if (!Array.isArray(response.actions)) {
    return { valid: false, error: 'Response must have an actions array' };
  }

  // Validate each action
  for (let i = 0; i < response.actions.length; i++) {
    const result = validateAction(response.actions[i]);
    if (!result.valid) {
      return { valid: false, error: `Action ${i}: ${result.error}` };
    }
  }

  return { valid: true };
}

// Aplikuj defaultni hodnoty na akci
export function applyDefaults(action) {
  const schema = ACTION_SCHEMAS[action.type];
  if (!schema || !schema.defaults) return action;

  return { ...schema.defaults, ...action };
}

export default {
  ACTION_TYPES,
  ACTION_SCHEMAS,
  validateAction,
  validateClaudeResponse,
  applyDefaults
};
