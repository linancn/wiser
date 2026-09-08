import { createHash } from 'node:crypto';
import {
  SourceRegistrationManifestSchema,
  SourceRegistrationSchema,
} from '@wiser/data-contracts';

interface RegistrationAsset {
  readonly assetId: string;
  readonly size: number;
  readonly sourceHash?: string;
  readonly mediaType: string;
}

export function parseSourceRegistration(input: {
  readonly registration: unknown;
  readonly assets: readonly RegistrationAsset[];
  readonly manifestText: string;
}) {
  try {
    const sourceRegistration = SourceRegistrationSchema.parse(
      input.registration,
    );
    const manifestHash = createHash('sha256')
      .update(input.manifestText)
      .digest('hex');
    if (
      Buffer.byteLength(input.manifestText) > 512 * 1024 ||
      manifestHash !== sourceRegistration.manifestSha256
    )
      throw new Error('manifest');
    const manifest = SourceRegistrationManifestSchema.parse(
      JSON.parse(input.manifestText) as unknown,
    );
    if (manifest.sourceId !== sourceRegistration.sourceId)
      throw new Error('source');
    const assets = new Map(input.assets.map((asset) => [asset.assetId, asset]));
    const manifestAsset = assets.get(sourceRegistration.manifestAssetId);
    if (
      assets.size !== input.assets.length ||
      manifestAsset?.sourceHash !== manifestHash ||
      manifestAsset.size !== Buffer.byteLength(input.manifestText) ||
      manifestAsset.mediaType !== 'application/json'
    )
      throw new Error('manifest asset');
    const matched = new Set([sourceRegistration.manifestAssetId]);
    const paths = new Set<string>();
    const emptyHash = createHash('sha256').update('').digest('hex');
    for (const file of manifest.files) {
      if (paths.has(file.path)) throw new Error('duplicate path');
      paths.add(file.path);
      if (
        file.disposition === 'IMPORT' &&
        (file.sha256 !== file.preparedSha256 ||
          file.sizeBytes !== file.preparedSizeBytes)
      )
        throw new Error('source change');
      if (file.assetId === undefined) {
        if (
          file.sizeBytes !== 0 ||
          file.preparedSizeBytes !== 0 ||
          file.sha256 !== emptyHash ||
          file.preparedSha256 !== emptyHash ||
          file.completeness !== 'EMPTY'
        )
          throw new Error('unbound file');
        continue;
      }
      const asset = assets.get(file.assetId);
      if (
        file.assetId === sourceRegistration.manifestAssetId ||
        asset?.sourceHash !== file.preparedSha256 ||
        asset.size !== file.preparedSizeBytes
      )
        throw new Error('asset mismatch');
      matched.add(file.assetId);
    }
    if (matched.size !== assets.size) throw new Error('unlisted asset');
    const parsedAssets = input.assets.map((asset) => {
      const files = manifest.files.filter(
        (candidate) => candidate.assetId === asset.assetId,
      );
      return {
        assetId: asset.assetId,
        kind: 'document' as const,
        contentHash: asset.sourceHash!,
        metadata: {
          'wiser:validationScope': 'SOURCE_REGISTRATION',
          'wiser:excerpt': (files.length === 0
            ? `${sourceRegistration.name}\n${JSON.stringify(manifest.record)}\n${sourceRegistration.limitations.join('\n')}`
            : `${files.map((file) => `${file.path}\n${file.artifactClass}\n${file.completeness}\nsha256:${file.sha256}`).join('\n')}\n${sourceRegistration.limitations.join('\n')}`
          ).slice(0, 8192),
        },
      };
    });
    return {
      validationScope: 'SOURCE_REGISTRATION' as const,
      sourceRegistration,
      parsedAssets,
    };
  } catch {
    throw new Error('SOURCE_REGISTRATION_INVALID');
  }
}
