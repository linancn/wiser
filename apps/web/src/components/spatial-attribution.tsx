const osmNotice = '© OpenStreetMap contributors · ODbL 1.0';
/** Recognize an explicit retained source notice, never infer licensing from a place name.
 * The destination is fixed; source values cannot inject markup or arbitrary links.
 * Other providers require their own reviewed attribution mapping before display.
 */
export function SpatialAttribution({
  collection,
}: {
  readonly collection: {
    readonly features: readonly {
      readonly properties?: Record<string, unknown> | null;
    }[];
  } | null;
}) {
  const declared = collection?.features.some((feature) => {
    const values: unknown = feature.properties?.['values'];
    return (
      values !== null &&
      typeof values === 'object' &&
      !Array.isArray(values) &&
      Object.values(values).includes(osmNotice)
    );
  });
  return declared ? (
    <p>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        {osmNotice}
      </a>
    </p>
  ) : null;
}
