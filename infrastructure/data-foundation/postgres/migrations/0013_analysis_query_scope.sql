-- Keep the same four scope predicates, but evaluate request-constant helpers
-- once per statement. The prior non-inlined wrapper ran all four helpers for
-- every analytical row, including rows scanned solely to count or sort a page.
drop policy analysis_scope on catalog.analysis_record;
create policy analysis_scope on catalog.analysis_record
using (
  tenant_id = (select security.current_tenant_id())
  and project_id = (select security.current_project_id())
  and security.security_rank(security_level)
    <= (select security.security_rank(security.current_max_security_level()))
  and policy_version <= (select security.current_policy_version())
)
with check (
  tenant_id = (select security.current_tenant_id())
  and project_id = (select security.current_project_id())
  and security.security_rank(security_level)
    <= (select security.security_rank(security.current_max_security_level()))
  and policy_version <= (select security.current_policy_version())
);
