-- ---------------------------------------------------------------------------
-- Migration 0005 — Referral count contract
-- Adds: increment_referral_count() RPC for referral accounting
-- ---------------------------------------------------------------------------

create or replace function public.increment_referral_count(p_code text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(trim(p_code));
  updated_count integer;
begin
  if normalized_code = '' then
    raise exception 'Referral code is required';
  end if;

  update public.referral_codes
  set used_count = used_count + 1
  where code = normalized_code
  returning used_count into updated_count;

  if not found then
    raise exception 'Referral code not found';
  end if;

  return updated_count;
end;
$$;

grant execute on function public.increment_referral_count(text) to authenticated;
