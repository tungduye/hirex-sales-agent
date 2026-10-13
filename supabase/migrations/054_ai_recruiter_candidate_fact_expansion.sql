begin;

alter table public.ai_recruiter_candidate_facts
  drop constraint if exists ai_recruiter_candidate_facts_field_key_check;

alter table public.ai_recruiter_candidate_facts
  add constraint ai_recruiter_candidate_facts_field_key_check check(field_key in (
    'candidate_type','current_role','seniority','primary_skills','years_experience','current_company',
    'location','preferred_locations','work_preference','japanese_level','english_level','japan_years',
    'current_salary','expected_salary','availability','motivation','job_priorities','applied_companies',
    'rejected_companies','management_experience','brse_experience','japanese_client_experience',
    'email','phone','cv_received'
  ));

commit;
