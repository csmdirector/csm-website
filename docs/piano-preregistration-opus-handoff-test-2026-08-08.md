# Opus existing-family self-booking handoff test

Date: 2026-08-08 (America/New_York)

Conclusion: **clean pre-payment handoff passed. Usable with guardrails; keep production disabled until preview acceptance is complete.**

## Clean retest

### Test identity

- Parent: Fake Handoff Parent
- Parent email: `piano.handoff.retry.20260808.2@yd3bhcva.mailosaur.net`
- Parent Opus ID: `375252d5-d91d-4f4b-abb4-0fd452c79561`
- Student: Fake Handoff Student
- Student Opus ID: `25fcdc80-7c43-4411-ae87-d4c6c7808eaf`
- CSM lead ID in note: `CSM-HANDOFF-20260808-02`
- Public link: Mason Piano Intro

The fresh family was created with one JSON POST to the real Opus inbound URL copied from the Opus screen. Opus returned HTTP `200` with `{"status":"ok","message":"inbound hook processed","action":"create","resource":"people","errors":[]}`. No tags or `parent1_status` were sent.

### Observed clean flow

1. Verified one linked parent/account manager and one student/dependent in the Opus staff UI before opening the public flow.
2. Opened the Mason Piano Intro link in a signed-out isolated browser session.
3. Selected Nedra K and the available August 20, 2026, 4:00–4:30 PM slot at CSM Mason.
4. Entered the webhook-created parent's exact email at Opus's identity step.
5. Opus recognized the email as existing and sent `Complete your booking with Cincinnati School of Music` to Mailosaur.
6. Followed the temporary continuation link. Opus authenticated as Fake Handoff Parent and preserved the service, staff, location, date, time, price, and single-visit plan.
7. Opened `Select a student`. The options were Fake Handoff Student, Fake Handoff Parent, and New student.
8. Selected Fake Handoff Student. The quote changed to `For Fake Handoff Student`, proving the unsubmitted booking draft was assigned to the existing webhook-created dependent.
9. Stopped before completing required questions, accepting terms, entering payment details, or clicking the final `Book` button.

### Duplicate and transaction checks

- Opus reused the original parent and original linked student through the inspected pre-payment state.
- The parent email search returned one parent record, and the authenticated account's student selector contained one Fake Handoff Student.
- The parent retained the same Opus ID and one dependent; the student retained the same Opus ID and one account manager.
- Student status remained `Prospect (new)`.
- The inbound `student_note` remained visible as a staff comment.
- Upcoming schedule: `No scheduled visit coming up`.
- Credits: `No credits available`.
- Subscriptions: `No active subscriptions`.
- Invoices: `No invoice due`.
- No terms were accepted, no payment details were entered, and no final booking was submitted.
- The only email caused by the public flow was Opus's expected continuation/authentication email after time selection.

### Guardrails and remaining uncertainty

- Selecting the existing student exposes two additional required Opus fields: `Student age` and `How did you hear about us?`. The CSM bridge should expect that repeated data-entry step unless Opus can configure or prefill those booking questions.
- This test proves reuse through the pre-payment draft. It deliberately does not prove post-payment completion behavior because the final booking/payment action was outside scope.
- Keep the server-side idempotency and recent-duplicate suppression in the bridge. Do not rely on Opus itself to deduplicate repeated inbound webhook POSTs.
- Do not automate ambiguous retries.

## Earlier invalidated test

### Test identity

- Parent: Fake Bridge Parent
- Parent email: `piano.bridge.20260808.0729@yd3bhcva.mailosaur.net`
- Parent Opus ID: `7e3ae63a-d58f-41e2-948d-5b7d8d481c3e`
- Student: Fake Bridge Student
- Student Opus ID: `8dd5baa5-a434-4a66-ba04-b1fbbe701f88`
- Public link: Mason Piano Intro

Both people had been created and correctly linked by the inbound webhook before this test.

### Observed flow

1. Opened the Mason Piano Intro booking link in a clean isolated browser session.
2. Selected Nedra K and the available Thursday, August 20, 2026, 4:30–5:00 PM slot at CSM Mason.
3. Clicked the first-stage `Book` control to reach the email identity step. No appointment or payment was created by this action.
4. Entered the webhook-created parent's exact email.
5. Opus responded: it already had the email on file and instructed the user to check email.
6. Mailosaur received `Complete your booking with Cincinnati School of Music`.
7. Followed the temporary continuation link in the same isolated booking session.
8. Opus authenticated as the existing Fake Bridge Parent and preserved the service, staff, location, date, time, price, and single-visit plan.
9. The continuation page reached the payment/setup screen.

### Interrupted result

The `Select a student` dropdown offered only:

- Fake Bridge Parent
- New student

It did not offer Fake Bridge Student at the time it was inspected.

The original student profile was then inspected in the staff UI and visibly showed `ACCOUNT DELETED`. The parent profile no longer showed a Dependents section. It was later clarified that the fake profiles had been manually deleted during the test, before this inspection.

Therefore, neither the deleted state nor the missing student option can be attributed to the email-authenticated booking flow. The test was invalidated before dependent selection could be verified.

### Duplicate and transaction checks

- Before manual cleanup invalidated the test, Opus recognized the webhook-created parent email and authenticated the continuation as Fake Bridge Parent.
- No duplicate parent was observed during the inspected portion of the flow.
- Duplicate/dependent behavior after authentication was not conclusively tested because the fake profiles were manually deleted.
- The selected appointment survived the email transition as an unsubmitted booking draft.
- No final `Book` action was taken on the payment page.
- Terms were not accepted.
- No card or other payment method was entered.
- Parent and student profiles showed no scheduled visit, credits, active subscription, or invoice.
- No payment or completed booking was created.

### Implication

The test proves that Opus recognizes the webhook-created parent email, sends its normal continuation email, and preserves the selected service, staff, location, date, time, price, and plan through authentication.

That first run did **not** prove dependent reuse because cleanup invalidated it. The clean retest above now proves that an undeleted webhook-created dependent appears in the student selector and can be assigned to the preserved pre-payment booking draft without creating another visible parent or student. Final paid completion remains intentionally untested.

## Cleanup still needed

Delete the fresh test records after review:

1. Fake Handoff Student — `25fcdc80-7c43-4411-ae87-d4c6c7808eaf`
2. Fake Handoff Parent — `375252d5-d91d-4f4b-abb4-0fd452c79561`

Delete the dependent first, then the account manager. The booking was not submitted, so no schedule, invoice, subscription, credit, or payment cleanup is expected.
