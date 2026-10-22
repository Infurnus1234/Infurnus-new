import { readFileSync, writeFileSync } from 'node:fs';
const directory = process.argv[2] ?? '.';
const path = `${directory}/android/app/google-services.json`;
const template = readFileSync(`${path}.example`, 'utf8');
const supplied = process.env.ANDROID_GOOGLE_SERVICES_JSON;
const config = JSON.parse(supplied || template);
if (!supplied) {
  for (const client of config.client) {
    for (const key of client.api_key ?? []) key.current_key = 'non-secret-ci-fixture-key';
  }
}
writeFileSync(path, JSON.stringify(config));
console.log(
  supplied
    ? 'Configured Android resources from CI secret'
    : 'Configured compile-only Android fixture; live Firebase is unavailable',
);
