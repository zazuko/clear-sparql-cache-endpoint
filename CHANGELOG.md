# clear-sparql-cache-endpoint

## 0.3.2

### Patch Changes

- bcdab75: Fix handling date data type.

## 0.3.1

### Patch Changes

- 497f5c6: All results were returned as strings, which was breaking the logic.

  Now, everything is converted as dateTime, and it assumes that a date having hours, minutes and seconds set to zero is a value converted from a date.

## 0.3.0

### Minor Changes

- 8781867: Change the SPARQL query in order to add more results

## 0.2.0

### Minor Changes

- 910151e: Simple date workaround using S3

## 0.1.0

### Minor Changes

- 831ff83: First release
