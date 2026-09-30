import 'dotenv/config';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MongoClient, BSON } from 'mongodb';

const { EJSON } = BSON;

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to continue.');
  process.exit(1);
}

const backupRoot = join(import.meta.dirname, '..', 'backups');
const command = process.argv[2] || 'backup';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function slug(name) {
  return name.replace(/[^\w.-]/g, '_');
}

async function backup(client) {
  const target = join(backupRoot, stamp);
  await mkdir(target, { recursive: true });
  const collections = await client.db().listCollections().toArray();
  const summary = [];
  for (const { name } of collections) {
    const documents = await client.db().collection(name).find({}).toArray();
    await writeFile(join(target, `${slug(name)}.json`), EJSON.stringify(documents, null, 2, { relaxed: false }), 'utf8');
    summary.push({ collection: name, documents: documents.length });
    console.log(`  ${name}: ${documents.length} document(s)`);
  }
  await writeFile(
    join(target, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), database: client.db().databaseName, collections: summary }, null, 2),
    'utf8'
  );
  console.log(`\nBackup written to ${target}`);
  return target;
}

async function restore(client, source) {
  const files = await readdir(source);
  const manifestName = 'manifest.json';
  if (!files.includes(manifestName)) {
    console.error(`${source} is not a backup directory (no manifest.json).`);
    process.exit(1);
  }
  const manifest = JSON.parse(await readFile(join(source, manifestName), 'utf8'));
  console.log(`Restoring ${manifest.database} from ${manifest.createdAt}\n`);
  for (const { collection } of manifest.collections) {
    const file = join(source, `${slug(collection)}.json`);
    const documents = EJSON.parse(await readFile(file, 'utf8'), { relaxed: false });
    const existing = await client.db().collection(collection).countDocuments();
    await client.db().collection(collection).deleteMany({});
    if (documents.length) {
      await client.db().collection(collection).insertMany(documents, { ordered: true });
    }
    console.log(`  ${collection}: ${existing} replaced with ${documents.length}`);
  }
  console.log('\nRestore complete.');
}

const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 15000 });
try {
  if (command === 'backup') {
    console.log(`Backing up "${client.db().databaseName}"\n`);
    await backup(client);
  } else if (command === 'restore') {
    const source = process.argv[3];
    if (!source) {
      console.error('Usage: node scripts/backup.js restore <backup-directory>');
      process.exit(1);
    }
    console.log('WARNING: this deletes every document in the restored collections first.\n');
    await restore(client, source);
  } else {
    console.error('Usage: node scripts/backup.js [backup|restore <dir>]');
    process.exit(1);
  }
} catch (error) {
  console.error(`\n${command} failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
