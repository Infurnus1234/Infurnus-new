import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

// Report locations only: never echo the matched credential or file contents.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter((file) => file && !file.endsWith('.md'));
const files = [...new Set([...tracked, ...untracked])];
const patterns = [
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /AKIA[0-9A-Z]{16}/,
];
let findings = 0;
for (const file of files) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue; // Intended deletions are absent in the working tree.
  }
  if (!stat.isFile()) continue;
  if (
    /(?:^|\/)(?:\.env(?:\..+)?|key\.properties|local\.properties)$|\.(?:jks|keystore|p12|pem|key)$/.test(
      file,
    ) &&
    !file.endsWith('.env.example')
  ) {
    console.error(`Private artifact must not be tracked: ${file}`);
    findings++;
    continue;
  }
  const text = readFileSync(file);
  if (text.includes(0)) continue;
  text
    .toString('utf8')
    .split('\n')
    .forEach((line, index) => {
      if (patterns.some((pattern) => pattern.test(line))) {
        console.error(`Potential credential: ${file}:${index + 1}`);
        findings++;
      }
    });
}
console.log(`Source secret scan: ${files.length} files, ${findings} findings`);
process.exitCode = findings ? 1 : 0;
