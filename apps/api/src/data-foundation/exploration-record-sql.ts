import type {
  RecordFilter,
  ExplorationTimeConfig,
} from '@wiser/data-contracts';

/** Only fixed SQL syntax is composed; source fields and values are parameters. */
export function recordProjection(parameters: unknown[]) {
  const bind = (value: unknown, type: string) => {
    parameters.push(value);
    return `$${parameters.length}::${type}`;
  };
  const fields = new Map<string, string>();
  const expressions: string[] = [];
  const scalar = (
    field: string,
    type: 'text' | 'number' | 'presence' | 'time',
    time?: ExplorationTimeConfig,
  ) => {
    if (type === 'time' && !time)
      throw new Error('Time configuration required');
    const key = JSON.stringify([
      type,
      field,
      time?.format,
      time?.utcOffsetMinutes,
    ]);
    const existing = fields.get(key);
    if (existing) return existing;
    const name = `field_${fields.size}`;
    const parameter = bind(field, 'text');
    const value = `r.record_values->(${parameter})`;
    const expression =
      type === 'time' && time
        ? `service.exploration_time(${value},${bind(time.format, 'text')},${bind(time.utcOffsetMinutes, 'integer')})`
        : type === 'number'
          ? `service.exploration_number(${value})`
          : type === 'presence'
            ? `(nullif(${value},'null'::jsonb) is not null)`
            : `(case when jsonb_typeof(${value}) in ('string','number','boolean') then r.record_values->>(${parameter}) end)`;
    expressions.push(`${expression} ${name}`);
    fields.set(key, name);
    return name;
  };
  const operators = {
    eq: '=',
    ne: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  } as const;
  const predicates = (filters: readonly RecordFilter[]) =>
    filters.map((filter) => {
      const field = scalar(
        filter.field,
        filter.type,
        filter.type === 'time' ? filter : undefined,
      );
      if (filter.type === 'presence')
        return filter.operator === 'isNull' ? `not ${field}` : field;
      const value = bind(
        filter.value,
        filter.type === 'time'
          ? 'timestamptz'
          : filter.type === 'number'
            ? 'numeric'
            : 'text',
      );
      return filter.operator === 'contains'
        ? `strpos(${field},${value})>0`
        : `${field} ${operators[filter.operator]} ${value}`;
    });
  return { bind, scalar, predicates, expressions };
}
