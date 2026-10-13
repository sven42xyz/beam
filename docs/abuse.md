# Handling reports and illegal content

This is the operator runbook for tee. It is not legal advice.

## How reports reach you

1. Anyone in a room (also on the lock screen of an encrypted room) can use **"Report content"**. Category and description are required, an email address is optional, so reports can be anonymous.
2. The report is stored in the `Moderation` Durable Object (kept 180 days) and sent by email to the `REPORT_TO` address (from `tee@chapter42.de`).
3. The email contains a **signed moderation link** (valid 14 days) for that one room. It opens a page with metadata and all reports for the room, never the content, and the actions:

| Action | Effect |
|---|---|
| **Block** | Nothing in the room can be read, uploaded or downloaded any more; all devices are disconnected. The room still expires as usual. |
| **Freeze** | Block, and keep the data for up to 90 days regardless of the usual expiry (e.g. for a preservation order). |
| **Unblock** | Back to normal, including normal expiry (a room that is already past its expiry is deleted shortly after). |
| **Delete** | Room and files are deleted immediately. |

Reports in the categories **child sexual abuse material (CSAM)** and **sexual violence / intimate images without consent** block the room automatically, before anyone has looked at it.

## Child sexual abuse material

1. **Never open, download or forward the content**, not even to check it. Possession is a criminal offence (§ 184b StGB); only acts that serve to fulfil legal duties are exempt.
2. The room is already blocked. Decide between:
   - **Freeze** if you are reporting it to the police and they may want the data, or
   - **Delete** if you are not going to report it further.
3. **Report it**, with room code, time of the report, the report ID and what you did, but no content:
   - local police / online report of your state police (Onlinewache), or the BKA, or
   - [jugendschutz.net](https://www.jugendschutz.net/hinweis-geben) or the [eco complaints office](https://www.eco.de/themen/beschwerdestelle/), which forward to law enforcement.
4. In encrypted rooms you cannot see the content and the authorities can only read it with the link including the key. If the reporter left a contact, tell the authorities.
5. Note what you did and when (the moderation page shows the stored reports).

## Sexual violence and intimate images without consent

Covers depictions of sexual violence, intimate images or videos shared without the person's consent (§ 201a, § 184k StGB), including hidden recordings and AI-generated or manipulated nude images of real people, and violent or animal pornography (§ 184a StGB).

1. Do not share the content. The room is already blocked.
2. If the reporter is the person shown and wants to press charges, **freeze** the room and point them to the police; otherwise **delete** it.
3. Reply to the reporter if they left an email address.

## Other categories

- **Violence, terrorism, hate; malware/phishing:** block (or freeze and report to the police if there is a threat to life or safety; DSA Art. 18 requires notifying the authorities then).
- **Copyright, personal data:** block or delete if the report is plausible. Unencrypted rooms can be checked with the room code; encrypted ones cannot, so act on the plausibility of the report.
- **Unfounded reports:** unblock if the room was blocked.

Where the reporter left an email address, reply with the decision (DSA Art. 16(5)). The room's users are anonymous, so there is nobody to send a statement of reasons to.

## Orders from authorities

- **Removal orders** (DSA Art. 9): delete or block as ordered and confirm to the authority.
- **Preservation / production orders** (DSA Art. 10, StPO, EU e-Evidence Regulation): freeze the room via a moderation link. If you have no current link, submit a report for the room yourself to get one.
- tee does not store IP addresses or accounts. Available data: room code, creation and activity times, item count and sizes, encrypted or not, stored reports, and the content of unencrypted rooms.

## Configuration

- `ADMIN_SECRET` (Worker secret): HMAC key for the moderation links. Rotating it invalidates all links.
- `REPORT_TO` (Worker secret): recipient of report emails; must be a verified Email Routing destination address.
