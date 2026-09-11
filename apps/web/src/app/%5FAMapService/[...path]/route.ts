// AMap's security proxy requires this exact first-level URL segment.
// Percent-encoding keeps Next.js from treating it as a private folder.
export { GET } from '../../api/maps/amap/[...path]/route';
