-- A send is claimed in the database BEFORE the mailbox is called, so two
-- concurrent approvals can never both send. A failed send releases the claim
-- (a human may retry); an unknown outcome (crash mid-call) stays 'sending' and
-- is never retried automatically.
alter table sent_messages add column if not exists status text not null default 'sent';
alter table sent_messages drop constraint if exists sent_messages_status_check;
alter table sent_messages add constraint sent_messages_status_check check (status in ('sending','sent','failed'));
alter table sent_messages add column if not exists error text;
