alter table platform.roles
  add column max_security_level text not null default 'L0_PUBLIC'
    constraint roles_max_security_level_check check (
      max_security_level in (
        'L0_PUBLIC',
        'L1_INTERNAL',
        'L2_RESTRICTED',
        'L3_CONFIDENTIAL'
      )
    );
