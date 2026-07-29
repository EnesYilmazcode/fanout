// OpenAI-compatible chat completions. Logic lives in lib/gateway.ts.
import { chatCompletions } from '../../../lib/gateway'

export const config = { runtime: 'edge' }
export default chatCompletions
