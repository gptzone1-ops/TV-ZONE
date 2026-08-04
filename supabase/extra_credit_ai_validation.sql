alter table public.extra_credit_requests
  add column if not exists ai_decision text,
  add column if not exists ai_confidence double precision,
  add column if not exists ai_analysis text,
  add column if not exists ai_model text,
  add column if not exists ai_reviewed_at timestamptz,
  add column if not exists ai_rejection_reason text,
  add column if not exists review_reason text;

alter table public.extra_credit_requests
  drop constraint if exists extra_credit_requests_ai_decision_check;

alter table public.extra_credit_requests
  add constraint extra_credit_requests_ai_decision_check check (
    ai_decision is null or ai_decision in (
      'processing',
      'auto_approved',
      'auto_rejected',
      'manual_review'
    )
  );

alter table public.extra_credit_requests
  drop constraint if exists extra_credit_requests_ai_confidence_check;

alter table public.extra_credit_requests
  add constraint extra_credit_requests_ai_confidence_check check (
    ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)
  );

create index if not exists extra_credit_requests_ai_decision_idx
  on public.extra_credit_requests(ai_decision, created_at desc);
