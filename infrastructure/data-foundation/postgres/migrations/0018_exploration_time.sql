-- Source time interpretation uses an explicit fixed UTC offset, never the session zone.
create or replace function service.exploration_time(value jsonb, source_format text, utc_offset_minutes integer)
returns timestamptz language plpgsql immutable parallel safe strict set search_path=pg_catalog as $$
declare
  source_text text;
  parts text[];
  local_value timestamp;
begin
  if jsonb_typeof(value)<>'string' or utc_offset_minutes not between -840 and 840 then return null; end if;
  source_text := btrim(value #>> '{}');
  if length(source_text)>128 then return null; end if;
  if source_format='iso-offset' then
    if source_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return null; end if;
    return source_text::timestamptz;
  elsif source_format='dmy-local' then
    parts := regexp_match(source_text,'^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4}) ([0-9]{1,2}):([0-5][0-9]):([0-5][0-9](?:\.[0-9]{1,6})?)$');
    if parts is null or parts[4]::integer>=24 then return null; end if;
    local_value := make_timestamp(parts[3]::integer,parts[2]::integer,parts[1]::integer,parts[4]::integer,parts[5]::integer,parts[6]::double precision);
  elsif source_format='ymd-local' then
    parts := regexp_match(source_text,'^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2}) ([0-9]{1,2}):([0-5][0-9]):([0-5][0-9](?:\.[0-9]{1,6})?)$');
    if parts is null or parts[4]::integer>=24 then return null; end if;
    local_value := make_timestamp(parts[1]::integer,parts[2]::integer,parts[3]::integer,parts[4]::integer,parts[5]::integer,parts[6]::double precision);
  else return null;
  end if;
  return (local_value-make_interval(mins=>utc_offset_minutes)) at time zone 'UTC';
exception when data_exception then return null;
end
$$;

create or replace function service.exploration_filter_matches(record_values jsonb, f jsonb) returns boolean
language sql immutable parallel safe as $$
  select coalesce(case f->>'type'
      when 'presence' then case f->>'operator'
        when 'isNull' then nullif(record_values->(f->>'field'),'null'::jsonb) is null
        when 'isNotNull' then nullif(record_values->(f->>'field'),'null'::jsonb) is not null end
      when 'text' then case when jsonb_typeof(record_values->(f->>'field')) in ('string','number','boolean') then case f->>'operator'
        when 'eq' then record_values->>(f->>'field')=f->>'value'
        when 'ne' then record_values->>(f->>'field')<>f->>'value'
        when 'contains' then strpos(record_values->>(f->>'field'),f->>'value')>0 end end
      when 'number' then case f->>'operator'
        when 'eq' then service.exploration_number(record_values->(f->>'field'))=service.exploration_number(f->'value')
        when 'ne' then service.exploration_number(record_values->(f->>'field'))<>service.exploration_number(f->'value')
        when 'gt' then service.exploration_number(record_values->(f->>'field'))>service.exploration_number(f->'value')
        when 'gte' then service.exploration_number(record_values->(f->>'field'))>=service.exploration_number(f->'value')
        when 'lt' then service.exploration_number(record_values->(f->>'field'))<service.exploration_number(f->'value')
        when 'lte' then service.exploration_number(record_values->(f->>'field'))<=service.exploration_number(f->'value') end
      when 'time' then case f->>'operator'
        when 'eq' then service.exploration_time(record_values->(f->>'field'),f->>'format',(f->>'utcOffsetMinutes')::integer)=service.exploration_time(f->'value','iso-offset',0)
        when 'ne' then service.exploration_time(record_values->(f->>'field'),f->>'format',(f->>'utcOffsetMinutes')::integer)<>service.exploration_time(f->'value','iso-offset',0)
        when 'gt' then service.exploration_time(record_values->(f->>'field'),f->>'format',(f->>'utcOffsetMinutes')::integer)>service.exploration_time(f->'value','iso-offset',0)
        when 'gte' then service.exploration_time(record_values->(f->>'field'),f->>'format',(f->>'utcOffsetMinutes')::integer)>=service.exploration_time(f->'value','iso-offset',0)
        when 'lt' then service.exploration_time(record_values->(f->>'field'),f->>'format',(f->>'utcOffsetMinutes')::integer)<service.exploration_time(f->'value','iso-offset',0)
        when 'lte' then service.exploration_time(record_values->(f->>'field'),f->>'format',(f->>'utcOffsetMinutes')::integer)<=service.exploration_time(f->'value','iso-offset',0) end
      end,false)
$$;

