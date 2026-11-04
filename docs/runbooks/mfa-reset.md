# Reset someone's two-step verification

**When:** a merchant user or platform admin lost both their authenticator and all recovery codes. A password reset
doesn't remove two-step verification, by design (SECURITY_PLAN.md §2).

1. **Verify identity out of band** before anything else: a call back to the phone number on the store's records, or
   a request from the store's owner for a staff member. For a platform admin, a second platform admin must approve.
   Never act on an email alone; this is the classic account-takeover route.
2. Record the ticket, who verified and how.
3. Run `reset-mfa <email>` as a one-off task ([one-off-task.md](one-off-task.md)). Expected output:
   `Two-step verification reset for user <id> (was on); all sessions signed out.` Exit code 2 means no such user.
4. Tell the person to sign in and turn two-step verification on again straight away (Your account → Two-step
   verification). Platform admins can't use platform tools until they do.
5. Check the API log for the task and attach the line to the ticket.
