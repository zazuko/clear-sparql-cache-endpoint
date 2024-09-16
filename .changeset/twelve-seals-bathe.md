---
"clear-sparql-cache-endpoint": patch
---

All results were returned as strings, which was breaking the logic.

Now, everything is converted as dateTime, and it assumes that a date having hours, minutes and seconds set to zero is a value converted from a date.
