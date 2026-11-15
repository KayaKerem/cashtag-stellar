

<style>
.markdown-body table {min-width: 100%;width: 100%;display: table;}
thead {min-width: 100%;width: 100%;}
th {min-width: 60%;width: 60%;}
th:last-child {min-width: 20%;width: 20%;}
th:first-child {min-width: 20%;width: 20%;}
</style>



# Scout Report - Contracts - 2026-11-16

## Summary

| <span style="color:green">Crate</span> | <span style="color:green">Status</span> | <span style="color:green">Critical</span> | <span style="color:green">Medium</span> | <span style="color:green">Minor</span> | <span style="color:green">Enhancement</span> | 
| - | - | - | - | - | - | 
| cliprail | Analyzed | 40 | 15 | 0 | 22 | 


Issues found:



- [Integer Overflow Or Underflow](#integer-overflow-or-underflow) (41 results) (Critical)

- [Unsafe Unwrap](#unsafe-unwrap) (2 results) (Medium)

- [Unsafe Map Get](#unsafe-map-get) (1 results) (Medium)

- [Avoid Vec Map Input](#avoid-vec-map-input) (27 results) (Medium)

- [Front Running](#front-running) (1 results) (Medium)

- [Dos Unexpected Revert With Storage](#dos-unexpected-revert-with-storage) (5 results) (Medium)



## Arithmetic



### Integer Overflow Or Underflow

**Impact:** Critical

**Issue:** Potential for integer arithmetic overflow/underflow. Consider checked, wrapping or saturating arithmetic.

**Description:** An overflow/underflow is typically caught and generates an error. When it is not caught, the operation will result in an inexact result which could lead to serious problems.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/integer-overflow-or-underflow)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 0 | cliprail | [dispute.rs:26:5 - 26:89](cliprail/src/dispute.rs) |
| 2 | cliprail | [dispute.rs:88:5 - 88:26](cliprail/src/dispute.rs) |
| 6 | cliprail | [dispute.rs:191:45 - 191:57](cliprail/src/dispute.rs) |
| 7 | cliprail | [dispute.rs:195:5 - 195:26](cliprail/src/dispute.rs) |
| 8 | cliprail | [epoch.rs:18:5 - 18:43](cliprail/src/epoch.rs) |
| 9 | cliprail | [epoch.rs:21:5 - 21:39](cliprail/src/epoch.rs) |
| 10 | cliprail | [epoch.rs:24:5 - 24:43](cliprail/src/epoch.rs) |
| 11 | cliprail | [epoch.rs:27:5 - 27:39](cliprail/src/epoch.rs) |
| 12 | cliprail | [epoch.rs:30:5 - 30:41](cliprail/src/epoch.rs) |
| 13 | cliprail | [epoch.rs:33:5 - 33:17](cliprail/src/epoch.rs) |
| 14 | cliprail | [epoch.rs:37:5 - 37:42](cliprail/src/epoch.rs) |
| 15 | cliprail | [epoch.rs:45:13 - 45:42](cliprail/src/epoch.rs) |
| 16 | cliprail | [epoch.rs:56:18 - 56:23](cliprail/src/epoch.rs) |
| 17 | cliprail | [epoch.rs:129:9 - 129:26](cliprail/src/epoch.rs) |
| 18 | cliprail | [epoch.rs:139:40 - 139:45](cliprail/src/epoch.rs) |
| 19 | cliprail | [epoch.rs:141:9 - 141:33](cliprail/src/epoch.rs) |
| 20 | cliprail | [epoch.rs:151:13 - 151:42](cliprail/src/epoch.rs) |
| 21 | cliprail | [epoch.rs:161:20 - 161:45](cliprail/src/epoch.rs) |
| 22 | cliprail | [epoch.rs:163:17 - 163:56](cliprail/src/epoch.rs) |
| 23 | cliprail | [epoch.rs:167:21 - 167:56](cliprail/src/epoch.rs) |
| 24 | cliprail | [epoch.rs:176:5 - 176:78](cliprail/src/epoch.rs) |
| 25 | cliprail | [epoch.rs:181:5 - 181:48](cliprail/src/epoch.rs) |
| 26 | cliprail | [epoch.rs:189:28 - 189:44](cliprail/src/epoch.rs) |
| 27 | cliprail | [epoch.rs:209:14 - 209:36](cliprail/src/epoch.rs) |
| 28 | cliprail | [epoch.rs:214:27 - 214:63](cliprail/src/epoch.rs) |
| 31 | cliprail | [storage.rs:104:18 - 104:53](cliprail/src/storage.rs) |
| 33 | cliprail | [storage.rs:187:17 - 187:47](cliprail/src/storage.rs) |
| 34 | cliprail | [lib.rs:91:9 - 91:25](cliprail/src/lib.rs) |
| 35 | cliprail | [lib.rs:137:24 - 137:29](cliprail/src/lib.rs) |
| 36 | cliprail | [lib.rs:394:9 - 394:28](cliprail/src/lib.rs) |
| 37 | cliprail | [lib.rs:452:9 - 452:21](cliprail/src/lib.rs) |
| 38 | cliprail | [lib.rs:536:72 - 536:77](cliprail/src/lib.rs) |
| 39 | cliprail | [lib.rs:538:68 - 538:73](cliprail/src/lib.rs) |
| 40 | cliprail | [lib.rs:539:57 - 539:62](cliprail/src/lib.rs) |
| 41 | cliprail | [lib.rs:540:21 - 540:71](cliprail/src/lib.rs) |
| 42 | cliprail | [lib.rs:540:60 - 540:65](cliprail/src/lib.rs) |
| 43 | cliprail | [lib.rs:541:59 - 541:64](cliprail/src/lib.rs) |
| 44 | cliprail | [lib.rs:543:60 - 543:65](cliprail/src/lib.rs) |
| 45 | cliprail | [lib.rs:592:25 - 592:64](cliprail/src/lib.rs) |
| 46 | cliprail | [lib.rs:644:21 - 644:62](cliprail/src/lib.rs) |


### Divide Before Multiply

**Impact:** Medium

**Issue:** Division before multiplication might result in a loss of precision

**Description:** Division before multiplication might result in a loss of precision

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/rust/divide-before-multiply)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 1 | cliprail | [dispute.rs:26:5 - 26:18](cliprail/src/dispute.rs) |



## Error Handling



### Unsafe Unwrap

**Impact:** Medium

**Issue:** Unsafe usage of `unwrap`

**Description:** This vulnerability class pertains to the inappropriate usage of the unwrap method in Rust, which is commonly employed for error handling. The unwrap method retrieves the inner value of an Option or Result, but if an error or None occurs, it triggers a panic and crashes the program.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/rust/unsafe-unwrap)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 4 | cliprail | [dispute.rs:172:16 - 172:54](cliprail/src/dispute.rs) |
| 5 | cliprail | [dispute.rs:173:18 - 173:71](cliprail/src/dispute.rs) |



## Authorization



### Unsafe Map Get

**Impact:** Medium

**Issue:** Unsafe access on Map, method could panic.

**Description:** This vulnerability class pertains to the inappropriate usage of the get method for Map in soroban

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/unsafe-map-get)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 30 | cliprail | [proof.rs:100:15 - 100:55](cliprail/src/proof.rs) |



## Best Practices



### Avoid Vec Map Input

**Impact:** Medium

**Issue:** Avoid accepting soroban_sdk::Vec or Map parameters without validating their contents.

**Description:** Soroban Vec and Map<K, V> parameters arrive as raw Val values. Validate or normalize every element before storing or reusing them so a bad conversion does not halt contract execution.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/avoid-vec-map-input)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 50 | cliprail | [lib.rs:222:35 - 222:57](cliprail/src/lib.rs) |
| 51 | cliprail | [lib.rs:264:9 - 264:29](cliprail/src/lib.rs) |
| 52 | cliprail | [lib.rs:308:9 - 308:27](cliprail/src/lib.rs) |
| 53 | cliprail | [lib.rs:245:36 - 245:62](cliprail/src/lib.rs) |
| 54 | cliprail | [lib.rs:252:33 - 252:51](cliprail/src/lib.rs) |


### Storage Change Events

**Impact:** Enhancement

**Issue:** Consider emiting an event when storage is modified

**Description:** Emiting an event when storage changes is a good practice to make the contracts more transparent and usable to its clients and observers

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/storage-change-events)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 55 | cliprail | [lib.rs:302:5 - 310:28](cliprail/src/lib.rs) |
| 56 | cliprail | [lib.rs:564:5 - 564:94](cliprail/src/lib.rs) |
| 57 | cliprail | [lib.rs:245:5 - 245:84](cliprail/src/lib.rs) |
| 58 | cliprail | [lib.rs:359:5 - 359:91](cliprail/src/lib.rs) |
| 59 | cliprail | [lib.rs:558:5 - 558:85](cliprail/src/lib.rs) |
| 60 | cliprail | [lib.rs:252:5 - 252:73](cliprail/src/lib.rs) |
| 61 | cliprail | [lib.rs:234:5 - 234:80](cliprail/src/lib.rs) |
| 62 | cliprail | [lib.rs:405:5 - 412:28](cliprail/src/lib.rs) |
| 63 | cliprail | [lib.rs:199:5 - 199:76](cliprail/src/lib.rs) |
| 64 | cliprail | [lib.rs:608:5 - 613:29](cliprail/src/lib.rs) |
| 65 | cliprail | [lib.rs:700:5 - 700:67](cliprail/src/lib.rs) |
| 66 | cliprail | [lib.rs:688:5 - 695:28](cliprail/src/lib.rs) |
| 67 | cliprail | [lib.rs:663:5 - 663:69](cliprail/src/lib.rs) |
| 68 | cliprail | [lib.rs:222:5 - 222:79](cliprail/src/lib.rs) |
| 69 | cliprail | [lib.rs:259:5 - 265:27](cliprail/src/lib.rs) |
| 70 | cliprail | [lib.rs:705:5 - 705:87](cliprail/src/lib.rs) |
| 71 | cliprail | [lib.rs:716:5 - 716:83](cliprail/src/lib.rs) |
| 72 | cliprail | [lib.rs:710:5 - 710:76](cliprail/src/lib.rs) |
| 73 | cliprail | [lib.rs:206:5 - 206:55](cliprail/src/lib.rs) |
| 74 | cliprail | [lib.rs:291:5 - 291:99](cliprail/src/lib.rs) |
| 75 | cliprail | [lib.rs:278:5 - 278:70](cliprail/src/lib.rs) |
| 76 | cliprail | [lib.rs:468:5 - 474:27](cliprail/src/lib.rs) |



## MEV



### Front Running

**Impact:** Medium

**Issue:** The transferred amount should be checked against a minimum to prevent front-running

**Description:** This lint checks for potential front-running vulnerabilities in token transfers

[**Learn More**](Consider implementing a minimum amount check before the transfer)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 3 | cliprail | [dispute.rs:165:5 - 165:96](cliprail/src/dispute.rs) |



## DoS



### Dos Unexpected Revert With Storage

**Impact:** Medium

**Issue:** This storage (vector or map) operation is called without access control

**Description:**  It occurs by preventing transactions by other users from being successfully executed forcing the blockchain state to revert to its original state.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/dos-unexpected-revert-with-storage)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 29 | cliprail | [proof.rs:71:11 - 71:14](cliprail/src/proof.rs) |
| 32 | cliprail | [storage.rs:177:7 - 177:16](cliprail/src/storage.rs) |
| 48 | cliprail | [lib.rs:770:17 - 770:26](cliprail/src/lib.rs) |
| 49 | cliprail | [lib.rs:779:21 - 779:30](cliprail/src/lib.rs) |


### Dos Unbounded Operation

**Impact:** Medium

**Issue:** In order to prevent a single transaction from consuming all the gas in a block, unbounded operations must be avoided

**Description:** In order to prevent a single transaction from consuming all the gas in a block, unbounded operations must be avoided. This includes loops that do not have a bounded number of iterations, and recursive calls.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/dos-unbounded-operation)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 47 | cliprail | [lib.rs:767:13 - 769:14](cliprail/src/lib.rs) |


