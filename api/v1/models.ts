// Lists available providers. Logic lives in lib/gateway.ts.
import { listModels } from '../../lib/gateway'

export const config = { runtime: 'edge' }
export default listModels
