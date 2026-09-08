-- Inline the bounded predicate tree during query planning instead of scanning filters per row.
create or replace function service.exploration_number(value jsonb) returns numeric
language sql immutable parallel safe called on null input as $$
  select case when jsonb_typeof(value) in ('number','string')
    and length(btrim(value #>> '{}')) <= 128
    and translate(btrim(value #>> '{}'),'0123456789.eE+-','') = ''
    and (strpos(lower(value #>> '{}'),'e')=0 or btrim(value #>> '{}') ~ '[eE][+-]?[0-9]{1,3}$')
    then (jsonb_path_query_first(value,'lax $ ? (@.type() == "number" || @.type() == "string").number()','{}',true) #>> '{}')::numeric else null end
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
      end,false)
$$;

create or replace function service.exploration_record_matches(record_values jsonb, filters jsonb) returns boolean
language sql immutable parallel safe as $$
  select filters is null or (jsonb_typeof(filters)='array' and jsonb_array_length(filters)<=8 and
    (filters->0 is null or service.exploration_filter_matches(record_values,filters->0))
    and (filters->1 is null or service.exploration_filter_matches(record_values,filters->1))
    and (filters->2 is null or service.exploration_filter_matches(record_values,filters->2))
    and (filters->3 is null or service.exploration_filter_matches(record_values,filters->3))
    and (filters->4 is null or service.exploration_filter_matches(record_values,filters->4))
    and (filters->5 is null or service.exploration_filter_matches(record_values,filters->5))
    and (filters->6 is null or service.exploration_filter_matches(record_values,filters->6))
    and (filters->7 is null or service.exploration_filter_matches(record_values,filters->7))
  )
$$;

alter function service.exploration_number(jsonb) reset search_path;
alter function service.exploration_record_matches(jsonb,jsonb) reset search_path;
