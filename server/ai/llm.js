import { config } from '../config.js';
import { createLLM } from '../../public/js/shared/llm.js';

export { LLMError, rankModels, rankGroq, rankGroqVision } from '../../public/js/shared/llm.js';

const keyHint = `${config.ai.provider === 'groq' ? 'GROQ_API_KEY' : 'XAI_API_KEY'} in your .env file`;
const llm = createLLM({ ...config.ai, keyHint });

export const aiEnabled = llm.enabled;
export const aiProvider = llm.provider;
export const resolveModel = llm.resolveModel;
export const streamChat = llm.streamChat;
export const complete = llm.complete;
export const agentStep = llm.agentStep;
export const aiStatus = llm.status;
