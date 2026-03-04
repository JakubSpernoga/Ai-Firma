import { getModelForDepartment } from './departments.js';
import { getSystemPrompt } from './system-prompts.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function callClaude(options) {
  const { departmentId, messages, systemPromptOverride = null, maxRetries = 2 } = options;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const model = getModelForDepartment(departmentId);
  const systemPrompt = systemPromptOverride || getSystemPrompt(departmentId);

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 16000,
          system: systemPrompt,
          messages: messages
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Claude API error');
      }

      const textContent = data.content
        ?.filter(block => block.type === 'text')
        ?.map(block => block.text)
        ?.join('\n') || '';

      const parsedResponse = parseClaudeResponse(textContent);

      if (parsedResponse.valid) {
        return parsedResponse.data;
      }

      if (attempt < maxRetries) {
        messages.push({ role: 'assistant', content: textContent });
        messages.push({
          role: 'user',
          content: 'Tvoje odpoved nebyla validni JSON. Odpovez POUZE: {"message": "...", "actions": [...]}'
        });
        continue;
      }

      lastError = new Error('Invalid JSON after retries');

    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
    }
  }

  throw lastError;
}

function parseClaudeResponse(text) {
  try {
    let jsonStr = text.trim();

    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const data = JSON.parse(jsonStr);

    if (typeof data.message !== 'string') {
      return { valid: false, error: 'Missing message field' };
    }
    if (!Array.isArray(data.actions)) {
      return { valid: false, error: 'Missing actions array' };
    }

    return { valid: true, data };

  } catch (error) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        if (typeof data.message === 'string' && Array.isArray(data.actions)) {
          return { valid: true, data };
        }
      } catch (e) {}
    }
    return { valid: false, error: error.message };
  }
}

export async function callDepartment(targetDept, question, sourceDept, context) {
  const messages = [];
  if (context) {
    messages.push({ role: 'user', content: '[Kontext]\n' + context });
    messages.push({ role: 'assistant', content: '{"message": "Rozumim.", "actions": []}' });
  }
  messages.push({ role: 'user', content: '[Dotaz od ' + sourceDept + ']\n' + question });
  return await callClaude({ departmentId: targetDept, messages });
}

export async function callDepartmentWithExecution(targetDept, instruction, sourceDept) {
  const messages = [{
    role: 'user',
    content: '[Ukol od ' + sourceDept + ']\n' + instruction
  }];
  return await callClaude({ departmentId: targetDept, messages });
}

export default { callClaude, callDepartment, callDepartmentWithExecution };
