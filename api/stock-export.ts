import { stockExportHandler } from '../server/http.ts';
export const config = { api: { bodyParser: false } };
export default stockExportHandler;
