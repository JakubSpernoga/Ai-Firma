export const DEPARTMENTS = {
  finance: {
    id: 'finance',
    name: 'Finance',
    title: 'Financni reditel',
    initials: 'FR',
    color: '#2563eb',
    model: 'claude-opus-4-20250514',
    description: 'Dane, cashflow, rozpocty, investice, fakturace'
  },
  projects: {
    id: 'projects',
    name: 'Projekty',
    title: 'Projektovy manazer',
    initials: 'PM',
    color: '#059669',
    model: 'claude-sonnet-4-20250514',
    description: 'Rizeni zakazek, harmonogramy, subdodavatele'
  },
  crm: {
    id: 'crm',
    name: 'CRM',
    title: 'Obchodni manazer',
    initials: 'CRM',
    color: '#d97706',
    model: 'claude-sonnet-4-20250514',
    description: 'Poptavky, klienti, nabidky, follow-upy'
  },
  administration: {
    id: 'administration',
    name: 'Administrativa',
    title: 'Asistentka',
    initials: 'AS',
    color: '#7c3aed',
    model: 'claude-sonnet-4-20250514',
    description: 'Emaily, dokumenty, organizace, komunikace'
  },
  ceo: {
    id: 'ceo',
    name: 'CEO',
    title: 'Business analytik',
    initials: 'BA',
    color: '#dc2626',
    model: 'claude-opus-4-20250514',
    description: 'Strategie, analyzy, navrhy, automatizace'
  }
};

export const DEPARTMENT_LIST = Object.values(DEPARTMENTS);

export function getDepartment(id) {
  return DEPARTMENTS[id] || null;
}

export function getModelForDepartment(departmentId) {
  const dept = DEPARTMENTS[departmentId];
  return dept ? dept.model : 'claude-sonnet-4-20250514';
}

export default DEPARTMENTS;
