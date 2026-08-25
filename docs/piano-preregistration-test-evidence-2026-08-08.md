# Piano pre-registration bridge: controlled test evidence

> **Later-state addendum:** These fake Opus profiles were manually deleted during a subsequent public self-booking handoff test. The resulting `ACCOUNT DELETED` state was cleanup performed by the user, not an observed effect of Opus authentication. A fresh clean retest later proved that Opus reuses the webhook-created parent and linked student through the pre-payment booking draft. See `piano-preregistration-opus-handoff-test-2026-08-08.md`.

Date: 2026-08-08 (America/New_York)

Environment: local Netlify preview with a temporary local Postgres database. Opus forwarding was enabled with the real inbound URL supplied only as a process environment variable. Office email was deliberately disabled for preview. No production deployment or analytics configuration changed.

## Submitted fake record

- CSM lead ID: `CSM-PRE-20260808-5FC210FA`
- Existing CSM family: No
- Preferred location: CSM Mason
- Preferred time: Weekday afternoons
- Parent: Fake Bridge Parent
- Parent email: `piano.bridge.20260808.0729@yd3bhcva.mailosaur.net`
- Parent phone: `+1 513-555-0191`
- Student: Fake Bridge Student
- Student birthdate: `2013-02-14`
- Attribution: Unknown; first and latest landing page `/book-piano-intro/`

## Exact Opus JSON payload

```json
{
  "student_first_name": "Fake Bridge",
  "student_last_name": "Student",
  "student_status": "Prospect (new)",
  "student_birthdate": "2013-02-14",
  "student_note": "Source: Unknown\nInstrument: Piano\nPreferred location: CSM Mason\nPreferred time window: Weekday afternoons\nCSM pre-registration timestamp: 2026-08-08T11:29:03.900Z\nCSM lead ID: CSM-PRE-20260808-5FC210FA\nStudent birthdate: 2013-02-14\nParent still needs to complete Opus booking/payment.",
  "parent1_first_name": "Fake Bridge",
  "parent1_last_name": "Parent",
  "parent1_email": "piano.bridge.20260808.0729@yd3bhcva.mailosaur.net",
  "parent1_primary_phone": "+15135550191"
}
```

Content type: `application/json`

No tags, `parent1_status`, booking, invoice, payment, subscription, schedule, or campaign/source fields were sent.

## Response and stored result

- Opus HTTP status: `200`
- Opus response body: `{"status":"ok","message":"inbound hook processed","action":"create","resource":"people","errors":[]}`
- CSM database status: `succeeded`
- Duplicate-of lead: none
- Booking URL stored and shown: `https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-mason`
- Office notification status: `disabled_preview`
- Office follow-up flag: true, because preview email delivery was intentionally disabled
- Submit request duration reported by Netlify Dev: 8.686 seconds
- Automatic retry: none

## Opus inspection

- Parent/account manager created: Fake Bridge Parent
- Parent Opus ID: `7e3ae63a-d58f-41e2-948d-5b7d8d481c3e`
- Student/dependent created: Fake Bridge Student
- Student Opus ID: `8dd5baa5-a434-4a66-ba04-b1fbbe701f88`
- Linkage: correct in both directions
- Student status: `Prospect (new)`
- Parent status: blank, as expected because `parent1_status` was omitted
- Student note: present as a staff comment, including source, instrument, location, time, timestamp, lead ID, and booking/payment reminder
- Tags: none created or attached
- Prospect board: student appears in the `Prospect (new)` column
- Upcoming schedule: empty
- Credits: empty
- Subscriptions: empty
- Invoices: empty
- Email: none appeared in the Mailosaur inbox after a delayed refresh
- Booking link: verified on the confirmation page but not clicked
- Google Ads booking conversion: no test campaign parameters were used, and the staged form contains no submit `dataLayer.push`, purchase event, or `generate_lead` event

## Cleanup

Delete the two linked fake Opus people after review:

1. Fake Bridge Student — `8dd5baa5-a434-4a66-ba04-b1fbbe701f88` — manually deleted
2. Fake Bridge Parent — `7e3ae63a-d58f-41e2-948d-5b7d8d481c3e` — manually deleted

The temporary local Postgres container was removed after this evidence was captured; it contained no production data and is not recoverable. No production CSM lead record was created.
