import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  IntakeDeclarationSchema,
  IntakeSourceFactsSchema,
} from '../../packages/data-contracts/src/index.ts';
import { assessIntake } from '../../packages/data-core/src/index.ts';

/** Provider-side checks only. The receiving API independently checks saved authority. */
export async function preflightFiles(sourcePath: string, profilePath: string) {
  const sourceStat = await stat(sourcePath),
    profileStat = await stat(profilePath);
  if (
    !sourceStat.isFile() ||
    !profileStat.isFile() ||
    profileStat.size > 131072
  )
    throw Error('INVALID_PREFLIGHT_FILES');
  const bytes = await readFile(profilePath);
  if (bytes.byteLength > 131072) throw Error('PROFILE_TOO_LARGE');
  const raw: unknown = JSON.parse(bytes.toString('utf8'));
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('declaration' in raw) ||
    !('facts' in raw)
  )
    throw Error('INVALID_PROFILE');
  const declaration = IntakeDeclarationSchema.parse(raw.declaration);
  const profile = IntakeSourceFactsSchema.parse(raw.facts);
  const hash = createHash('sha256');
  let prefix = Buffer.alloc(0),
    size = 0;
  for await (const value of createReadStream(sourcePath, {
    highWaterMark: 65536,
  })) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as string);
    size += chunk.length;
    hash.update(chunk);
    if (prefix.length < 1024)
      prefix = Buffer.concat([prefix, chunk.subarray(0, 1024 - prefix.length)]);
  }
  const sourceHash = hash.digest('hex');
  const profileReused =
    profile.sourceHash === sourceHash && profile.byteSize === size;
  const html = /^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(
    prefix.toString('utf8'),
  );
  const facts = {
    ...profile,
    sourceHash,
    byteSize: size,
    ...(!profileReused
      ? {
          parserVersion: null,
          status: null,
          columns: [],
          recordCount: null,
          featureCount: null,
          reason: null,
        }
      : {}),
    ...(html
      ? {
          mediaType: 'text/html',
          status: 'INVALID' as const,
          reason: 'LOGIN_OR_DESCRIPTION_PAGE',
        }
      : {}),
  };
  return {
    kind: 'PROVIDER_SELF_CHECK' as const,
    profileReused,
    selfCheck: { ruleVersion: 'wiser.intake.v1' as const, sourceHash },
    result: assessIntake(declaration, facts),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [source, profile] = process.argv.slice(2);
  if (!source || !profile) {
    process.stderr.write(
      'Usage: pnpm exec tsx scripts/data-foundation/intake-preflight.mts <original-file> <profile.json>\n',
    );
    process.exitCode = 2;
  } else
    try {
      process.stdout.write(
        JSON.stringify(await preflightFiles(source, profile), null, 2) + '\n',
      );
    } catch {
      process.stderr.write(
        'Self-check failed: verify the original and bounded profile. No server state changed.\n',
      );
      process.exitCode = 1;
    }
}
