import path from 'node:path';
import { createApp } from './src/app.js';
import { Store } from './src/store.js';

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'db.json');

const store = new Store(dataFile);
const app = createApp(store);

app.listen(port, '0.0.0.0', () => {
  console.log(`Meog ERP listening on http://0.0.0.0:${port} (data: ${dataFile})`);
});
