# CRM migration dry-run preview

**No production data has been imported by this preview.**

| Check | Result |
|---|---:|
| Current leads preserved | 57 |
| Current call/event logs preserved | 51 |
| Legacy rows read | 11119 |
| Current leads matched one-to-one by phone | 57 |
| New legacy-only leads to create | 11062 |
| Legacy status events to import | 15418 |
| **Final leads** | **11119** |
| **Final call/event logs** | **15469** |
| Generated lead ID range | CB-000058 – CB-011119 |
| Approved “Ineligible - Cold lead” fallbacks | 3 → Follow Up - Cold / Decision Pending |
| Spreadsheet-placeholder dates handled with Assign Date | 1 |
| Duplicate final lead IDs | 0 |
| Duplicate final log IDs | 0 |
| Legacy logs without a destination lead | 0 |
| Mapped statuses absent from Status_Rules | 0 |

## Mapped legacy history

| New status | Events |
|---|---:|
| CNR | 3869 |
| 1st Follow Up Need | 3467 |
| Ineligible | 1937 |
| 2nd Follow Up Need | 1774 |
| Onboarded (complete profile) | 1736 |
| Managed by KAM | 1142 |
| 1st Trip Complete | 563 |
| Awaiting 1st Trip | 492 |
| Contacted — Interested | 376 |
| Not Interested | 59 |
| Follow Up - Cold | 3 |

## Agents without current CRM accounts

| Legacy agent | Rows | Handling |
|---|---:|---|
| SK Fardin Osi | 1129 | Preserved as text; no new user created |

## Migration behavior

- Current lead IDs and base details are preserved; legacy rows add history to their matching leads.
- Only legacy-only phones receive new sequential lead IDs.
- Exact legacy times were unavailable; fixed early times preserve status-date and contact/FU ordering.
- Old statuses are stored with Entry Source = Legacy. Newer current-tracker logs remain authoritative by timestamp.
- Legacy remarks and unmatched agent names are preserved in notes/history.
- Generated IDs are deterministic, so a failed import can be rerun without duplication.
