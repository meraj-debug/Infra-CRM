// Boots a real mongod and holds it open so the actual server can connect.
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';

const mem = await MongoMemoryServer.create({ instance: { port: 27055, dbName: 'inframantra' } });
fs.writeFileSync(process.argv[2], mem.getUri());
console.log('mongod up at', mem.getUri());
process.on('SIGTERM', async () => { await mem.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
