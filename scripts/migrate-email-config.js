import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to continue.');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const dryRun = !apply;

const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 15000 });
const products = client.db().collection('products');

function migrate(product) {
  const legacy = {
    sendEmailImmediately: product.sendEmailImmediately === true,
    requireAdminMessage: product.requireAdminMessage === true,
    emailSubject: typeof product.emailSubject === 'string' ? product.emailSubject : '',
    emailIntroduction: typeof product.emailIntroduction === 'string' ? product.emailIntroduction : '',
  };
  const existing = product.emailConfig || {};
  return {
    ...product,
    emailConfig: {
      sendEmailImmediately: existing.sendEmailImmediately ?? legacy.sendEmailImmediately,
      immediateEmailMode: existing.immediateEmailMode ?? 'acknowledgement',
      notifyTeam: existing.notifyTeam ?? true,
      requireAdminMessage: existing.requireAdminMessage ?? legacy.requireAdminMessage,
      customerSubject: existing.customerSubject ?? legacy.emailSubject,
      customerBody: existing.customerBody ?? legacy.emailIntroduction,
      teamSubject: existing.teamSubject ?? '',
      teamBody: existing.teamBody ?? '',
    },
  };
}

const all = await products.find({}).toArray();
console.log(`${dryRun ? 'DRY RUN' : 'APPLYING'} emailConfig migration to "${client.db().databaseName}".products\n`);

let changed = 0;
for (const product of all) {
  const before = JSON.stringify({
    s: product.sendEmailImmediately,
    r: product.requireAdminMessage,
    sub: product.emailSubject,
    intro: product.emailIntroduction,
    hasConfig: Boolean(product.emailConfig),
  });
  const next = migrate(product);
  const after = JSON.stringify({
    s: next.emailConfig.sendEmailImmediately,
    r: next.emailConfig.requireAdminMessage,
    sub: next.emailConfig.customerSubject,
    intro: next.emailConfig.customerBody,
    hasConfig: true,
  });
  const wasMigrated = Boolean(product.emailConfig);
  if (before === after && wasMigrated) {
    console.log(`  = ${product.id} (already migrated, unchanged)`);
    continue;
  }
  changed++;
  const mode = next.emailConfig.sendEmailImmediately ? next.emailConfig.immediateEmailMode : 'held for review';
  console.log(`  ${wasMigrated ? '~' : '+'} ${product.id}`);
  console.log(
    `      sendEmailImmediately: ${next.emailConfig.sendEmailImmediately} | mode: ${mode} | notifyTeam: ${next.emailConfig.notifyTeam}`
  );
  console.log(
    `      requireAdminMessage: ${next.emailConfig.requireAdminMessage} | subject: ${next.emailConfig.customerSubject ? 'set' : 'default'} | body: ${next.emailConfig.customerBody ? 'set' : 'default'}`
  );
  if (apply) {
    const { _id, ...rest } = next;
    await products.replaceOne({ _id }, rest);
    await products.updateOne(
      { _id },
      { $unset: { sendEmailImmediately: '', requireAdminMessage: '', emailSubject: '', emailIntroduction: '' } }
    );
  }
}

console.log(
  `\n${changed} product(s) ${dryRun ? 'would change' : 'migrated'}. Take a backup with "npm run backup" before running with --apply.`
);

if (!apply) {
  console.log('Re-run with --apply to write these changes.');
}

await client.close();
