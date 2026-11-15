

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
| reclaim_verify | Analyzed | 39 | 1 | 0 | 0 | 


Issues found:



- [Unsafe Unwrap](#unsafe-unwrap) (1 results) (Medium)

- [Integer Overflow Or Underflow](#integer-overflow-or-underflow) (39 results) (Critical)



## Error Handling



### Unsafe Unwrap

**Impact:** Medium

**Issue:** Unsafe usage of `unwrap`

**Description:** This vulnerability class pertains to the inappropriate usage of the unwrap method in Rust, which is commonly employed for error handling. The unwrap method retrieves the inner value of an Option or Result, but if an error or None occurs, it triggers a panic and crashes the program.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/rust/unsafe-unwrap)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 0 | reclaim-verify | [lib.rs:172:5 - 172:41](reclaim-verify/src/lib.rs) |



## Arithmetic



### Integer Overflow Or Underflow

**Impact:** Critical

**Issue:** Potential for integer arithmetic overflow/underflow. Consider checked, wrapping or saturating arithmetic.

**Description:** An overflow/underflow is typically caught and generates an error. When it is not caught, the operation will result in an inexact result which could lead to serious problems.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/integer-overflow-or-underflow)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 1 | reclaim-verify | [lib.rs:204:9 - 204:15](reclaim-verify/src/lib.rs) |
| 2 | reclaim-verify | [lib.rs:205:18 - 205:39](reclaim-verify/src/lib.rs) |
| 3 | reclaim-verify | [lib.rs:211:13 - 211:26](reclaim-verify/src/lib.rs) |
| 4 | reclaim-verify | [lib.rs:224:13 - 224:22](reclaim-verify/src/lib.rs) |
| 5 | reclaim-verify | [lib.rs:225:13 - 225:22](reclaim-verify/src/lib.rs) |
| 6 | reclaim-verify | [lib.rs:229:16 - 229:35](reclaim-verify/src/lib.rs) |
| 7 | reclaim-verify | [lib.rs:230:5 - 230:25](reclaim-verify/src/lib.rs) |
| 8 | reclaim-verify | [lib.rs:232:5 - 232:46](reclaim-verify/src/lib.rs) |
| 9 | reclaim-verify | [lib.rs:234:5 - 234:56](reclaim-verify/src/lib.rs) |
| 10 | reclaim-verify | [lib.rs:239:5 - 239:44](reclaim-verify/src/lib.rs) |
| 11 | reclaim-verify | [lib.rs:240:12 - 240:17](reclaim-verify/src/lib.rs) |
| 12 | reclaim-verify | [lib.rs:241:5 - 241:10](reclaim-verify/src/lib.rs) |
| 13 | reclaim-verify | [lib.rs:250:17 - 250:22](reclaim-verify/src/lib.rs) |
| 14 | reclaim-verify | [lib.rs:253:22 - 253:28](reclaim-verify/src/lib.rs) |
| 15 | reclaim-verify | [lib.rs:254:37 - 254:42](reclaim-verify/src/lib.rs) |
| 16 | reclaim-verify | [lib.rs:254:48 - 254:53](reclaim-verify/src/lib.rs) |
| 17 | reclaim-verify | [lib.rs:255:18 - 255:24](reclaim-verify/src/lib.rs) |
| 18 | reclaim-verify | [lib.rs:270:50 - 270:59](reclaim-verify/src/lib.rs) |
| 19 | reclaim-verify | [lib.rs:270:61 - 270:66](reclaim-verify/src/lib.rs) |
| 20 | reclaim-verify | [lib.rs:272:25 - 272:35](reclaim-verify/src/lib.rs) |
| 21 | reclaim-verify | [lib.rs:273:25 - 273:31](reclaim-verify/src/lib.rs) |
| 22 | reclaim-verify | [lib.rs:278:26 - 278:32](reclaim-verify/src/lib.rs) |
| 23 | reclaim-verify | [lib.rs:283:91 - 283:102](reclaim-verify/src/lib.rs) |
| 24 | reclaim-verify | [lib.rs:284:31 - 284:36](reclaim-verify/src/lib.rs) |
| 25 | reclaim-verify | [lib.rs:298:19 - 298:37](reclaim-verify/src/lib.rs) |
| 26 | reclaim-verify | [lib.rs:305:35 - 305:40](reclaim-verify/src/lib.rs) |
| 27 | reclaim-verify | [lib.rs:310:31 - 310:36](reclaim-verify/src/lib.rs) |
| 28 | reclaim-verify | [lib.rs:313:31 - 313:38](reclaim-verify/src/lib.rs) |
| 29 | reclaim-verify | [lib.rs:314:27 - 314:47](reclaim-verify/src/lib.rs) |
| 30 | reclaim-verify | [lib.rs:334:41 - 334:46](reclaim-verify/src/lib.rs) |
| 31 | reclaim-verify | [lib.rs:336:31 - 336:38](reclaim-verify/src/lib.rs) |
| 32 | reclaim-verify | [lib.rs:337:27 - 337:47](reclaim-verify/src/lib.rs) |
| 33 | reclaim-verify | [lib.rs:357:9 - 357:15](reclaim-verify/src/lib.rs) |
| 34 | reclaim-verify | [lib.rs:359:31 - 359:38](reclaim-verify/src/lib.rs) |
| 35 | reclaim-verify | [lib.rs:360:27 - 360:47](reclaim-verify/src/lib.rs) |
| 36 | reclaim-verify | [lib.rs:395:42 - 395:52](reclaim-verify/src/lib.rs) |
| 37 | reclaim-verify | [lib.rs:409:18 - 409:58](reclaim-verify/src/lib.rs) |
| 38 | reclaim-verify | [lib.rs:402:28 - 402:36](reclaim-verify/src/lib.rs) |
| 39 | reclaim-verify | [lib.rs:403:18 - 403:31](reclaim-verify/src/lib.rs) |


