import { config } from '../config.js';
import { createGrok } from '../../public/js/shared/grok.js';

export { GrokError, rankModels } from '../../public/js/shared/grok.js';

const grok = createGrok({ ...config.xai, keyHint: 'XAI_API_KEY in your .env file' });

export const aiEnabled = grok.enabled;
export const resolveModel = grok.resolveModel;
export const streamChat = grok.streamChat;
export const complete = grok.complete;
export const aiStatus = grok.status;
