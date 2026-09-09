import { describe, expect, it } from 'vitest';
import { resolveAnalysisSource } from '../src/analysis-source.js';

const files = [
  { assetId: 'shape', path: 'basin/stations.shp' },
  { assetId: 'attributes', path: 'basin/stations.dbf' },
  { assetId: 'index', path: 'basin/stations.shx' },
  { assetId: 'crs', path: 'basin/stations.prj' },
  { assetId: 'unrelated', path: 'other/stations.dbf' },
  { assetId: 'script', path: 'basin/run.py' },
  { assetId: 'header', path: 'coverage/hdr.adf' },
  { assetId: 'grid', path: 'coverage/w001001.adf' },
  { assetId: 'projection', path: 'coverage/prj.adf' },
];
describe('version-local analysis format groups', () => {
  it('resolves exact Shapefile companions without adjacent scripts or other directories', () => {
    expect(
      resolveAnalysisSource('shape', 'application/octet-stream', files),
    ).toEqual({
      format: 'shp',
      path: 'basin/stations.shp',
      companions: files.slice(1, 4),
      companionOf: null,
    });
    expect(
      resolveAnalysisSource('attributes', 'application/octet-stream', files),
    ).toMatchObject({ format: null, companionOf: 'shape' });
  });
  it('analyzes an ArcInfo coverage once and keeps every physical member linked', () => {
    expect(
      resolveAnalysisSource('header', 'application/octet-stream', files),
    ).toEqual({
      format: 'adf',
      path: 'coverage/hdr.adf',
      companions: files.slice(7),
      companionOf: null,
    });
    expect(
      resolveAnalysisSource('grid', 'application/octet-stream', files),
    ).toMatchObject({ format: null, companionOf: 'header' });
  });
  it('routes Word uploads by their admitted MIME type', () => {
    expect(
      resolveAnalysisSource('word', 'application/msword', []),
    ).toMatchObject({ format: 'doc' });
    expect(
      resolveAnalysisSource(
        'word',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        [],
      ),
    ).toMatchObject({ format: 'docx' });
  });
  it('recognizes actual admitted suffixes and falls back to MIME for uploads without source paths', () => {
    expect(
      resolveAnalysisSource('raster', 'application/octet-stream', [
        { assetId: 'raster', path: 'source.TIFF' },
      ]),
    ).toMatchObject({ format: 'tiff', path: 'source.TIFF' });
    expect(
      resolveAnalysisSource('nc', 'application/x-netcdf', []),
    ).toMatchObject({ format: 'nc', path: 'nc.nc' });
    expect(resolveAnalysisSource('doc', 'text/markdown', [])).toMatchObject({
      format: 'md',
      path: 'doc.md',
    });
    expect(
      resolveAnalysisSource('unknown', 'application/octet-stream', []),
    ).toMatchObject({ format: null, companionOf: null });
  });
});
