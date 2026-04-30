-- ArmCare sessions — RLS for direct-from-device inserts.
--
-- Background: the iOS ArmCare wizard writes directly to Supabase from the
-- device using the signed-in athlete's JWT (no /api/armcare hop). RLS must
-- explicitly allow that insert. The two policies below cover:
--
--   1) Athletes inserting their own sessions (the common case).
--   2) Guardians inserting on behalf of a linked athlete (parent mode in the
--      app, where a parent runs the wizard for their kid).
--
-- Coaches who manage athletes via a separate policy infrastructure are not
-- handled here — extend later if direct-capture by coaches becomes a path.
--
-- The matching SELECT policy is presumed to already exist (the existing
-- ArmCare history screen reads rows). If not, the second migration block
-- below mirrors the same shape for SELECT.
--
-- Apply via Supabase Studio SQL editor or `supabase db push`.

alter table public.armcare_sessions enable row level security;

-- ─── INSERT: athlete inserting their own session ─────────────────────────
drop policy if exists "athletes can insert their own armcare sessions"
  on public.armcare_sessions;
create policy "athletes can insert their own armcare sessions"
  on public.armcare_sessions for insert to authenticated
  with check (
    exists (
      select 1 from public.athletes a
      where a.id = athlete_id
        and a.user_id = auth.uid()
    )
  );

-- ─── INSERT: guardian inserting for a linked athlete ─────────────────────
drop policy if exists "guardians can insert armcare sessions for their athletes"
  on public.armcare_sessions;
create policy "guardians can insert armcare sessions for their athletes"
  on public.armcare_sessions for insert to authenticated
  with check (
    exists (
      select 1
      from public.athletes a
      join public.athlete_guardians g on g.athlete_id = a.user_id
      where a.id = athlete_id
        and g.guardian_id = auth.uid()
    )
  );

-- ─── SELECT (defensive — only added if missing) ─────────────────────────
-- The history screen reads rows scoped to athlete_id. If a SELECT policy
-- already exists we leave it alone. Otherwise create the equivalent.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'armcare_sessions'
      and cmd = 'SELECT'
  ) then
    execute $sql$
      create policy "athletes and guardians can read their armcare sessions"
        on public.armcare_sessions for select to authenticated
        using (
          exists (
            select 1 from public.athletes a
            where a.id = athlete_id
              and (
                a.user_id = auth.uid()
                or exists (
                  select 1 from public.athlete_guardians g
                  where g.athlete_id = a.user_id
                    and g.guardian_id = auth.uid()
                )
              )
          )
        );
    $sql$;
  end if;
end$$;
